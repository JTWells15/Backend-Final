require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const State = require('./models/States');
const app = express();

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let statesData = [];
try {
  statesData = JSON.parse(fs.readFileSync('./statesData.json', 'utf8'));
  console.log(`✅ Loaded ${statesData.length} states`);
} catch (e) {
  console.error('❌ Missing statesData.json - ADD IT TO REPO!');
}

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

mongoose.connection.on('connected', async () => {
  console.log('✅ MongoDB Connected - Seeding data...');
  await seedFunFacts();
});

async function seedFunFacts() {
  const defaultFacts = {
    KS: ['Wichita = Air Capital', 'Helium discovered here', 'Tornado capital'],
    MO: ['St Louis urban forest', 'First parachute', 'Mark Twain born'],
    OK: ['Most man-made lakes', 'Route 66 starts', '"Red people"'],
    NE: ['Coast midpoint', '25% US corn', 'Carhenge'],
    CO: ['Most ski resorts', '54 fourteeners', 'Highest capital']
  };

  for (const s of statesData) {
    const code = s.code.toUpperCase();
    const factsArray = defaultFacts[code];

    if (Array.isArray(factsArray) && factsArray.length) {
      await State.findOneAndUpdate(
        { stateCode: code },
        { stateCode: code, $setOnInsert: { funfacts: factsArray } },
        { upsert: true, new: true }
      );
    } else {
      await State.findOneAndUpdate(
        { stateCode: code },
        { stateCode: code, $setOnInsert: { funfacts: [] } },
        { upsert: true, new: true }
      );
    }
  }

  console.log(`✅ Seeded records for all ${statesData.length} states`);
}

const codeToState = new Map(statesData.map((s) => [s.code.toUpperCase(), s]));

function getCode(param) {
  return String(param || '').toUpperCase();
}

function getStateByCode(code) {
  return codeToState.get(code);
}

function isValidCode(code) {
  return codeToState.has(code);
}

function mapBaseState(state) {
  return {
    state: state.state,
    abbreviation: state.code,
    capital_city: state.capital_city,
    nickname: state.nickname,
    population: state.population,
    admission_date: state.admission_date
  };
}

function formatPopulation(num) {
  return Number(num).toLocaleString('en-US');
}

function invalidAbbr(res) {
  return res.status(400).json({ message: 'Invalid state abbreviation parameter' });
}

const statesWithFunfactsInList = new Set(['KS', 'NE', 'OK', 'MO', 'CO']);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/states/', async (req, res) => {
  const { contig } = req.query;
  let states = statesData;

  if (contig === 'true' || contig === 'false') {
    states = states.filter((s) => !['AK', 'HI'].includes(s.code));
  }

  const result = await Promise.all(
    states.map(async (s) => {
      const mongo = await State.findOne({ stateCode: s.code }).lean();
      const base = mapBaseState(s);
      if (
        statesWithFunfactsInList.has(s.code) &&
        mongo &&
        Array.isArray(mongo.funfacts) &&
        mongo.funfacts.length >= 3
      ) {
        return { ...base, funfacts: mongo.funfacts };
      }
      return base;
    })
  );

  res.json(result);
});

app.get('/states/:state', async (req, res) => {
  const code = getCode(req.params.state);
  if (!isValidCode(code)) return invalidAbbr(res);

  const state = getStateByCode(code);
  const mongo = await State.findOne({ stateCode: code }).lean();

  const payload = mapBaseState(state);
  if (mongo && Array.isArray(mongo.funfacts) && mongo.funfacts.length > 0) {
    payload.funfacts = mongo.funfacts;
  }

  res.json(payload);
});

app.get('/states/:state/funfact', async (req, res) => {
  const code = getCode(req.params.state);
  if (!isValidCode(code)) return invalidAbbr(res);

  const state = getStateByCode(code);
  const mongo = await State.findOne({ stateCode: code }).lean();
  if (!mongo?.funfacts?.length) {
    return res.status(404).json({ message: `No Fun Facts found for ${state.state}` });
  }

  const randomFact = mongo.funfacts[Math.floor(Math.random() * mongo.funfacts.length)];
  res.json({ funfact: randomFact });
});

app.get('/states/:state/capital', (req, res) => {
  const code = getCode(req.params.state);
  if (!isValidCode(code)) return invalidAbbr(res);
  const state = getStateByCode(code);
  res.json({ state: state.state, capital: state.capital_city });
});

app.get('/states/:state/nickname', (req, res) => {
  const code = getCode(req.params.state);
  if (!isValidCode(code)) return invalidAbbr(res);
  const state = getStateByCode(code);
  res.json({ state: state.state, nickname: state.nickname });
});

app.get('/states/:state/population', (req, res) => {
  const code = getCode(req.params.state);
  if (!isValidCode(code)) return invalidAbbr(res);
  const state = getStateByCode(code);
  res.json({ state: state.state, population: formatPopulation(state.population) });
});

app.get('/states/:state/admission', (req, res) => {
  const code = getCode(req.params.state);
  if (!isValidCode(code)) return invalidAbbr(res);
  const state = getStateByCode(code);
  res.json({ state: state.state, admitted: state.admission_date });
});

app.post('/states/:state/funfact', async (req, res) => {
  const code = getCode(req.params.state);
  if (!isValidCode(code)) return invalidAbbr(res);

  const { funfacts } = req.body;
  if (funfacts === undefined) {
    return res.status(400).json({ message: 'State fun facts value required' });
  }
  if (!Array.isArray(funfacts)) {
    return res.status(400).json({ message: 'State fun facts value must be an array' });
  }

  const state = getStateByCode(code);

  const updated = await State.findOneAndUpdate(
    { stateCode: code },
    { $push: { funfacts: { $each: funfacts } } },
    { upsert: true, new: true }
  ).lean();

  res.json({
    message: `Successfully added fun facts for ${state.state}`,
    funfacts: updated.funfacts
  });
});

app.patch('/states/:state/funfact', async (req, res) => {
  const code = getCode(req.params.state);
  if (!isValidCode(code)) return invalidAbbr(res);

  const { index, funfact } = req.body;
  if (index === undefined) {
    return res.status(400).json({ message: 'State fun fact index value required' });
  }
  if (typeof funfact !== 'string' || !funfact.trim()) {
    return res.status(400).json({ message: 'State fun fact value required' });
  }

  const stateMeta = getStateByCode(code);
  const stateDoc = await State.findOne({ stateCode: code });
  if (!stateDoc?.funfacts?.length) {
    return res.status(404).json({ message: `No Fun Facts found for ${stateMeta.state}` });
  }

  const idx = Number(index) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= stateDoc.funfacts.length) {
    return res.status(400).json({ message: `No Fun Fact found at that index for ${stateMeta.state}` });
  }

  stateDoc.funfacts[idx] = funfact;
  await stateDoc.save();

  res.json({
    message: `Successfully updated fun fact for ${stateMeta.state}`,
    funfacts: stateDoc.funfacts
  });
});

app.delete('/states/:state/funfact', async (req, res) => {
  const code = getCode(req.params.state);
  if (!isValidCode(code)) return invalidAbbr(res);

  const { index } = req.body;
  if (index === undefined) {
    return res.status(400).json({ message: 'State fun fact index value required' });
  }

  const stateMeta = getStateByCode(code);
  const stateDoc = await State.findOne({ stateCode: code });
  if (!stateDoc?.funfacts?.length) {
    return res.status(404).json({ message: `No Fun Facts found for ${stateMeta.state}` });
  }

  const idx = Number(index) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= stateDoc.funfacts.length) {
    return res.status(400).json({ message: `No Fun Fact found at that index for ${stateMeta.state}` });
  }

  stateDoc.funfacts.splice(idx, 1);
  await stateDoc.save();

  res.json({
    message: `Successfully deleted fun fact for ${stateMeta.state}`,
    funfacts: stateDoc.funfacts
  });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 US STATES API v1.0');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Root: http://localhost:${PORT}/`);
  console.log(`📊 API:  http://localhost:${PORT}/states/`);
});
