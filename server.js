require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const DB_NAME = process.env.DB_NAME || 'colegio_cchn';
const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en variables de entorno');

const corsDelegate = (req, callback) => {
  const origin = req.header('Origin') || '*';
  callback(null, {
    origin: origin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
    exposedHeaders: ['Content-Type'],
    credentials: false,
    maxAge: 86400
  });
};

app.use((req, res, next) => {
  const origin = req.header('Origin') || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(cors(corsDelegate));
app.options('*', cors(corsDelegate));
app.use(express.json());

const client = new MongoClient(MONGODB_URI);
let db;

function auth(req, res, next) {
  if (!API_KEY) return next();
  if (req.header('x-api-key') !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'API key inválida' });
  }
  next();
}
app.use('/api', auth);

function toPlainDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value).split('T')[0] : d.toISOString().split('T')[0];
}

app.get('/health', async (req, res) => {
  try {
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    res.json({ ok: true, dbName: DB_NAME, collections: cols.map(c => c.name) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/courses', async (re
