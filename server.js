require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const DB_NAME = process.env.DB_NAME || 'colegio_cchn';
const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en variables de entorno');

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

app.get('/api/courses', async (req, res) => {
  try {
    const raw = await db.collection('courses').find({ active: true }).sort({ level: 1, section: 1, name: 1 }).toArray();
    const courses = raw.map(c => ({
      _id: String(c._id),
      id: String(c._id),
      name: c.name || `${c.level || ''} ${c.section || ''}`.trim() || String(c._id),
      level: c.level || '',
      section: c.section || '',
      schoolYear: c.schoolYear || null,
      studentCount: c.studentCount || 0,
      active: Boolean(c.active)
    }));
    res.json({ ok: true, courses });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/data', async (req, res) => {
  try {
    const courseId = String(req.query.courseId || '').trim();
    const today 
