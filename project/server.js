require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const State = require('./models/States');
const app = express();

// PORT 5000 for Render compatibility
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static('public'));

// Load statesData.json
let statesData = [];
try {
  statesData = JSON.parse(fs.readFileSync('./statesData.json', 'utf8'));
  console.log(`✅ Loaded ${statesData.length} states`);
} catch (e) {
  console.error('❌ Missing statesData.json - ADD IT TO REPO!');
}

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

mongoose.connection.on('connected', async () => {
  console.log('✅ MongoDB Connected - Seeding data...');
  await seedFunFacts();
});

async function seedFunFacts() {
  const facts = {
    KS: ['Wichita = Air Capital', 'Helium discovered here', 'Tornado capital'],
    MO: ['St Louis urban forest', 'First parachute', 'Mark Twain born'],
    OK: ['Most man-made lakes', 'Route 66 starts', '"Red people"'],
    NE: ['Coast midpoint', '25% US corn', 'Carhenge'],
    CO: ['Most ski resorts', '54 fourteeners', 'Highest capital']
  };
  
  for (let [code, factsArray] of Object.entries(facts)) {
    await State.findOneAndUpdate(
      { stateCode: code },
      { stateCode: code, funfacts: factsArray },
      { upsert: true }
    );
  }
  console.log('✅ Seeded KS,MO,OK,NE,CO fun facts');
}

// ==================== ROUTES ====================

// Root HTML
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

// All states
app.get('/states/', async (req, res) => {
  const { contig } = req.query;
  let states = statesData;
  
  if (contig === 'true') states = states.filter(s => !['AK','HI'].includes(s.stateCode));
  if (contig === 'false') states = states.filter(s => ['AK','HI'].includes(s.stateCode));
  
  const withFacts = await Promise.all(states.map(async s => {
    const mongo = await State.findOne({ stateCode: s.stateCode });
    return { ...s, funfacts: mongo?.funfacts || [] };
  }));
  res.json(withFacts);
});

// Single state
app.get('/states/:state', async (req, res) => {
  const state = statesData.find(s => s.stateCode === req.params.state.toUpperCase());
  if (!state) return res.status(404).json({ error: 'Not Found' });
  
  const mongo = await State.findOne({ stateCode: req.params.state.toUpperCase() });
  res.json({ ...state, funfacts: mongo?.funfacts || [] });
});

// Random funfact
app.get('/states/:state/funfact', async (req, res) => {
  const mongo = await State.findOne({ stateCode: req.params.state.toUpperCase() });
  if (!mongo?.funfacts?.length) return res.status(404).json({ error: 'No fun facts' });
  res.json({ funfact: mongo.funfacts[Math.floor(Math.random() * mongo.funfacts.length)] });
});

// Field-specific
['capital','nickname','population','admission'].forEach(field => {
  app.get(`/states/:state/${field}`, (req, res) => {
    const state = statesData.find(s => s.stateCode === req.params.state.toUpperCase());
    if (!state) return res.status(404).json({ error: 'Not Found' });
    res.json({ state: state.stateName, [field]: state[field] });
  });
});

// POST funfact
app.post('/states/:state/funfact', async (req, res) => {
  const { funfacts } = req.body;
  if (!Array.isArray(funfacts) || !funfacts.length) {
    return res.status(400).json({ error: 'funfacts array required' });
  }
  
  const state = await State.findOneAndUpdate(
    { stateCode: req.params.state.toUpperCase() },
    { $push: { funfacts: { $each: funfacts } } },
    { upsert: true, new: true }
  );
  res.json(state);
});

// PATCH funfact (1-based index)
app.patch('/states/:state/funfact', async (req, res) => {
  const { index, funfact } = req.body;
  if (!index || !funfact) return res.status(400).json({ error: 'index, funfact required' });
  
  const state = await State.findOne({ stateCode: req.params.state.toUpperCase() });
  if (!state?.funfacts?.length) return res.status(404).json({ error: 'No funfacts' });
  
  const idx = parseInt(index) - 1;
  if (idx < 0 || idx >= state.funfacts.length) return res.status(400).json({ error: 'Bad index' });
  
  state.funfacts[idx] = funfact;
  await state.save();
  res.json(state);
});

// DELETE funfact (1-based index)
app.delete('/states/:state/funfact', async (req, res) => {
  const { index } = req.body;
  if (!index) return res.status(400).json({ error: 'index required' });
  
  const state = await State.findOne({ stateCode: req.params.state.toUpperCase() });
  if (!state?.funfacts?.length) return res.status(404).json({ error: 'No funfacts' });
  
  const idx = parseInt(index) - 1;
  if (idx < 0 || idx >= state.funfacts.length) return res.status(400).json({ error: 'Bad index' });
  
  state.funfacts.splice(idx, 1);
  await state.save();
  res.json(state);
});

// 404
app.use('/states/*', (req, res) => {
  const accept = req.get('Accept') || '';
  res.status(404);
  if (accept.includes('text/html')) {
    res.send('<h1 style="text-align:center;font-family:sans-serif;padding:50px">404 - Route Not Found<br><a href="/">Home</a></h1>');
  } else {
    res.json({ error: '404 Not Found' });
  }
});

app.use('*', (req, res) => res.status(404).send('<h1>404</h1>'));

// START SERVER - PORT 5000 + Render binding
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 US STATES API v1.0');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Root: http://localhost:${PORT}/`);
  console.log(`📊 API:  http://localhost:${PORT}/states/`);
});