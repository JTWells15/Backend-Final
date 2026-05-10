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
app.use(express.static(path.join(__dirname, 'public')));

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
async function getStateWithFunfacts(stateCode, includeEmptyFunfacts = true) {
  const normalized = stateCode.toUpperCase();
  const stateData = statesData.find(s => s.stateCode === normalized);
  if (!stateData) return null;

  const mongoState = await State.findOne({ stateCode: normalized });
  const funfacts = mongoState?.funfacts || [];

  if (includeEmptyFunfacts) return { ...stateData, funfacts };
  if (funfacts.length) return { ...stateData, funfacts };
  return { ...stateData };
}

function getStateByCode(stateCode) {
  return statesData.find(s => s.stateCode === stateCode.toUpperCase()) || null;
}

function invalidStateAbbreviation(res) {
  return res.status(400).json({ message: 'Invalid state abbreviation parameter' });
}

// 🏠 ROOT: HTML landing page
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index')));

// 📊 STATES API ROUTES
app.get('/states/', async (req, res) => {
  const { contig } = req.query;

  let filtered = statesData;
  if (contig === 'true') filtered = statesData.filter(s => !['AK', 'HI'].includes(s.stateCode));
  if (contig === 'false') filtered = statesData.filter(s => ['AK', 'HI'].includes(s.stateCode));

  const statesWithFacts = await Promise.all(
    filtered.map(async state => getStateWithFunfacts(state.stateCode, false))
  );

  res.json(statesWithFacts);
});

app.get('/states/:state', async (req, res) => {
  const stateCode = req.params.state.toUpperCase();
  if (!getStateByCode(stateCode)) return invalidStateAbbreviation(res);

  const state = await getStateWithFunfacts(stateCode, true);
  res.json(state);
});

app.get('/states/:state/funfact', async (req, res) => {
  const stateCode = req.params.state.toUpperCase();
  const baseState = getStateByCode(stateCode);
  if (!baseState) return invalidStateAbbreviation(res);

  const state = await getStateWithFunfacts(stateCode, true);
  const { funfacts } = state;

  if (!funfacts?.length) {
    return res.status(404).json({ message: `No Fun Facts found for ${baseState.stateName}` });
  }

  res.json({ funfact: funfacts[Math.floor(Math.random() * funfacts.length)] });
});

app.get('/states/:state/capital', async (req, res) => {
  const state = getStateByCode(req.params.state);
  if (!state) return invalidStateAbbreviation(res);
  res.json({ state: state.stateName, capital: state.capital });
});

app.get('/states/:state/nickname', async (req, res) => {
  const state = getStateByCode(req.params.state);
  if (!state) return invalidStateAbbreviation(res);
  res.json({ state: state.stateName, nickname: state.nickname });
});

app.get('/states/:state/population', async (req, res) => {
  const state = getStateByCode(req.params.state);
  if (!state) return invalidStateAbbreviation(res);
  res.json({ state: state.stateName, population: Number(state.population).toLocaleString('en-US') });
});

app.get('/states/:state/admission', async (req, res) => {
  const state = getStateByCode(req.params.state);
  if (!state) return invalidStateAbbreviation(res);
  res.json({ state: state.stateName, admitted: state.admission });
});

// ➕ POST: Add funfacts (append to existing)
app.post('/states/:state/funfact', async (req, res) => {
  const state = getStateByCode(req.params.state);
  if (!state) return invalidStateAbbreviation(res);

  const { funfacts } = req.body;

  if (!funfacts) return res.status(400).json({ message: 'State fun facts value required' });
  if (!Array.isArray(funfacts)) return res.status(400).json({ message: 'State fun facts value must be an array' });

  const stateCode = req.params.state.toUpperCase();
  const existing = await State.findOne({ stateCode });

  if (existing) {
    existing.funfacts.push(...funfacts);
    await existing.save();
    return res.json(await State.findOne({ stateCode }));
  }

  const created = await State.create({ stateCode, funfacts });
  res.json(created);
});

// ✏️ PATCH: Replace funfact by 1-based index
app.patch('/states/:state/funfact', async (req, res) => {
  const baseState = getStateByCode(req.params.state);
  if (!baseState) return invalidStateAbbreviation(res);

  const { index, funfact } = req.body;
  if (!index) return res.status(400).json({ message: 'State fun fact index value required' });
  if (!funfact) return res.status(400).json({ message: 'State fun fact value required' });

  const state = await State.findOne({ stateCode: req.params.state.toUpperCase() });
  if (!state?.funfacts?.length) {
    return res.status(404).json({ message: `No Fun Facts found for ${baseState.stateName}` });
  }

  const idx = Number(index) - 1;
  if (idx < 0 || idx >= state.funfacts.length) {
    return res.status(404).json({ message: `No Fun Fact found at that index for ${baseState.stateName}` });
  }

  state.funfacts[idx] = funfact;
  await state.save();
  res.json(state);
});

// 🗑️ DELETE: Remove funfact by 1-based index
app.delete('/states/:state/funfact', async (req, res) => {
  const baseState = getStateByCode(req.params.state);
  if (!baseState) return invalidStateAbbreviation(res);

  const { index } = req.body;
  if (!index) return res.status(400).json({ message: 'State fun fact index value required' });

  const state = await State.findOne({ stateCode: req.params.state.toUpperCase() });
  if (!state?.funfacts?.length) {
    return res.status(404).json({ message: `No Fun Facts found for ${baseState.stateName}` });
  }

  const idx = Number(index) - 1;
  if (idx < 0 || idx >= state.funfacts.length) {
    return res.status(404).json({ message: `No Fun Fact found at that index for ${baseState.stateName}` });
  }

  state.funfacts.splice(idx, 1);
  await state.save();
  res.json(state);
});

// 🚫 404 Catch-all (HTML/JSON based on Accept header)
app.use('/states/*', (req, res) => {
  res.status(404).json({ message: 'Invalid state abbreviation parameter' });
});

app.use('*', (req, res) => {
  res.status(404).send(`<h1>404 - Page Not Found</h1><a href="/">Home</a>`);
});

// 🚀 Start Server
app.listen(PORT, () => {
  console.log(`\n🌐 Server running: http://localhost:${PORT}/`);
  console.log(`📡 API ready: http://localhost:${PORT}/states/`);
});