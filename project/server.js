const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const State = require('./models/States');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Load and normalize statesData.json
let statesData;
try {
  const rawStatesData = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'statesData.json'), 'utf8')
  );
  statesData = rawStatesData.map((s) => ({
    ...s,
    stateCode: s.code,
    stateName: s.state,
    capital: s.capital_city,
    admission: s.admission_date
  }));
} catch (error) {
  console.error('❌ Error loading statesData.json:', error);
  process.exit(1);
}

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, '❌ MongoDB error:'));
db.once('open', async () => {
  console.log('✅ Connected to MongoDB');
  await seedFunFacts();
});

// SEED: Fun facts for KS, MO, OK, NE, CO (3+ each, unique from statesData.json)
async function seedFunFacts() {
  const funFactsData = {
    'KS': ['Wichita: "Air Capital of the World"', 'First helium discovery', 'Most tornadoes per sq mile'],
    'MO': ['Largest urban forest in St. Louis', 'First parachute jump', 'Mark Twain birthplace'],
    'OK': ['Most man-made lakes', '"Red people" in Choctaw', 'Route 66 starts here'],
    'NE': ['Kearney at 100th meridian', '25% of US corn', 'Carhenge monument'],
    'CO': ['Most ski resorts', '54 peaks over 14,000 ft', 'Highest capital elevation']
  };

  for (const [stateCode, facts] of Object.entries(funFactsData)) {
    const existing = await State.findOne({ stateCode });
    if (!existing?.funfacts?.length) {
      await State.findOneAndUpdate(
        { stateCode },
        { stateCode, funfacts: facts },
        { upsert: true, new: true }
      );
      console.log(`✅ Seeded ${stateCode}: ${facts.length} fun facts`);
    }
  }
}

// Helper: Merge JSON data with MongoDB funfacts
async function getStateWithFunfacts(stateCode) {
  const stateData = statesData.find(s => s.stateCode === stateCode.toUpperCase());
  if (!stateData) return null;
  
  const mongoState = await State.findOne({ stateCode: stateCode.toUpperCase() });
  return { ...stateData, funfacts: mongoState?.funfacts || [] };
}

// 🏠 ROOT: HTML landing page
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

// 📊 STATES API ROUTES
app.get('/states/', async (req, res) => {
  const { contig } = req.query;
  
  let filtered = statesData;
  if (contig === 'true') filtered = statesData.filter(s => !['AK', 'HI'].includes(s.stateCode));
  if (contig === 'false') filtered = statesData.filter(s => ['AK', 'HI'].includes(s.stateCode));
  
  const statesWithFacts = await Promise.all(
    filtered.map(async state => ({
      ...state,
      funfacts: (await State.findOne({ stateCode: state.stateCode }))?.funfacts || []
    }))
  );
  
  res.json(statesWithFacts);
});

app.get('/states/:state', async (req, res) => {
  const state = await getStateWithFunfacts(req.params.state);
  if (!state) return res.status(404).json({ error: '404 Not Found' });
  res.json(state);
});

app.get('/states/:state/funfact', async (req, res) => {
  const state = await getStateWithFunfacts(req.params.state);
  if (!state) return res.status(404).json({ error: '404 Not Found' });
  
  const { funfacts } = state;
  if (!funfacts?.length) return res.status(404).json({ error: 'No fun facts found for this state' });
  
  res.json({ funfact: funfacts[Math.floor(Math.random() * funfacts.length)] });
});

app.get('/states/:state/capital', async (req, res) => {
  const state = statesData.find(s => s.stateCode === req.params.state.toUpperCase());
  if (!state) return res.status(404).json({ error: '404 Not Found' });
  res.json({ state: state.stateName, capital: state.capital });
});

app.get('/states/:state/nickname', async (req, res) => {
  const state = statesData.find(s => s.stateCode === req.params.state.toUpperCase());
  if (!state) return res.status(404).json({ error: '404 Not Found' });
  res.json({ state: state.stateName, nickname: state.nickname });
});

app.get('/states/:state/population', async (req, res) => {
  const state = statesData.find(s => s.stateCode === req.params.state.toUpperCase());
  if (!state) return res.status(404).json({ error: '404 Not Found' });
  res.json({ state: state.stateName, population: state.population });
});

app.get('/states/:state/admission', async (req, res) => {
  const state = statesData.find(s => s.stateCode === req.params.state.toUpperCase());
  if (!state) return res.status(404).json({ error: '404 Not Found' });
  res.json({ state: state.stateName, admitted: state.admission });
});

// ➕ POST: Add funfacts (append to existing)
app.post('/states/:state/funfact', async (req, res) => {
  const { funfacts } = req.body;
  if (!funfacts?.length || !Array.isArray(funfacts)) {
    return res.status(400).json({ error: 'funfacts array is required' });
  }
  
  try {
    const stateCode = req.params.state.toUpperCase();
    let state = await State.findOne({ stateCode });
    
    if (state) state.funfacts.push(...funfacts);
    else state = new State({ stateCode, funfacts });
    
    await state.save();
    res.json(state);
  } catch (error) {
    res.status(400).json({ error: 'State code must be unique' });
  }
});

// ✏️ PATCH: Replace funfact by 1-based index
app.patch('/states/:state/funfact', async (req, res) => {
  const { index, funfact } = req.body;
  if (!index || !funfact) return res.status(400).json({ error: 'index and funfact required' });
  
  const state = await State.findOne({ stateCode: req.params.state.toUpperCase() });
  if (!state?.funfacts?.length) return res.status(404).json({ error: 'No fun facts found' });
  
  const idx = parseInt(index) - 1;
  if (idx < 0 || idx >= state.funfacts.length) return res.status(400).json({ error: 'Invalid index' });
  
  state.funfacts[idx] = funfact;
  await state.save();
  res.json(state);
});

// 🗑️ DELETE: Remove funfact by 1-based index
app.delete('/states/:state/funfact', async (req, res) => {
  const { index } = req.body;
  if (!index) return res.status(400).json({ error: 'index required' });
  
  const state = await State.findOne({ stateCode: req.params.state.toUpperCase() });
  if (!state?.funfacts?.length) return res.status(404).json({ error: 'No fun facts found' });
  
  const idx = parseInt(index) - 1;
  if (idx < 0 || idx >= state.funfacts.length) return res.status(400).json({ error: 'Invalid index' });
  
  state.funfacts.splice(idx, 1);
  await state.save();
  res.json(state);
});

// 🚫 404 Catch-all (HTML/JSON based on Accept header)
app.use('/states/*', (req, res) => {
  const accept = req.get('Accept') || '';
  res.status(404);
  
  if (accept.includes('text/html')) {
    res.send(`<h1>404 - Route Not Found</h1><p>${req.originalUrl}</p><a href="/">Home</a>`);
  } else {
    res.json({ error: '404 Not Found' });
  }
});

app.use('*', (req, res) => {
  res.status(404).send(`<h1>404 - Page Not Found</h1><a href="/">Home</a>`);
});

// 🚀 Start Server
app.listen(PORT, () => {
  console.log(`\n🌐 Server running: http://localhost:${PORT}/`);
  console.log(`📡 API ready: http://localhost:${PORT}/states/`);
});