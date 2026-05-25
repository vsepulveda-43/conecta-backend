require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const DB_NAME = process.env.DB_NAME || 'colegio_cchn';
const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en variables de entorno');

app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

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

app.get('/api/courses', async (req, res) => {
  try {
    const raw = await db.collection('courses').find({ active: true }).sort({ level: 1, section: 1, name: 1 }).toArray();
    const courses = raw.map(c => ({ _id: String(c._id), id: String(c._id), name: c.name || `${c.level || ''} ${c.section || ''}`.trim() || String(c._id) }));
    res.json({ ok: true, courses });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/data', async (req, res) => {
  try {
    const courseId = String(req.query.courseId || '').trim();
    const today = String(req.query.today || '').trim();
    const userQuery = { active: true };
    if (courseId) userQuery.courseId = courseId;

    const rawUsers = await db.collection('users').find(userQuery).sort({ listNumber: 1, name: 1 }).toArray();
    const users = rawUsers
      .filter(u => !u.role || u.role === 'student' || u.role === 'alumno' || u.role === 'estudiante')
      .map(u => ({ id: String(u._id), nombre: u.name || u.firstName || 'Sin nombre', curso: u.courseName || u.courseId || '', courseId: u.courseId || '', role: u.role || '' }));

    let courseName = '';
    if (courseId) {
      const course = await db.collection('courses').findOne({ _id: courseId });
      courseName = course ? (course.name || courseId) : courseId;
    }

    const emQuery = {};
    if (courseId) emQuery.courseId = courseId;
    if (today) { emQuery.dayKey = today; emQuery.date = today; }

    const rawEmotions = await db.collection('emotions').find(emQuery).sort({ registeredAt: -1 }).toArray();
    const emotions = rawEmotions.map(e => ({
      id: e._id ? String(e._id) : String(e.id || ''),
      studentId: String(e.studentId || ''),
      nombre: e.studentName || e.nombre || '',
      emotion: e.emotion || '',
      emotionGroup: e.emotionGroup || '',
      date: e.dayKey || e.date || toPlainDate(e.registeredAt),
      attended: Boolean(e.attended),
      courseId: e.courseId || '',
      sessionId: e.sessionId || '',
      source: e.source || '',
      note: e.note || '',
      registeredAt: e.registeredAt || null,
      dayKey: e.dayKey || '',
      weekKey: e.weekKey || '',
      monthKey: e.monthKey || '',
      semesterKey: e.semesterKey || '',
      yearKey: e.yearKey || ''
    }));

    const rawCourses = await db.collection('courses').find({ active: true }).sort({ level: 1, section: 1, name: 1 }).toArray();
    const courses = rawCourses.map(c => ({ _id: String(c._id), id: String(c._id), name: c.name || `${c.level || ''} ${c.section || ''}`.trim() || String(c._id) }));

    res.json({ ok: true, courseId, courseName, users, emotions, courses });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    const incoming = req.body.emotions;
    if (!Array.isArray(incoming) || incoming.length === 0) return res.status(400).json({ ok: false, error: 'emotions[] requerido' });
    const docs = incoming.map(e => ({
      id: String(e.id || ''), studentId: String(e.studentId || ''), studentName: String(e.nombre || e.studentName || ''), nombre: String(e.nombre || e.studentName || ''), emotion: String(e.emotion || ''), emotionGroup: String(e.emotionGroup || ''), source: String(e.source || 'web'), note: String(e.note || ''), courseId: String(e.courseId || ''), courseName: String(e.courseName || ''), sessionId: String(e.sessionId || ''), attended: Boolean(e.attended), registeredAt: new Date(e.registeredAt || new Date()), dayKey: String(e.dayKey || e.date || toPlainDate(e.registeredAt || new Date())), weekKey: String(e.weekKey || ''), monthKey: String(e.monthKey || ''), semesterKey: String(e.semesterKey || ''), yearKey: String(e.yearKey || new Date().getFullYear())
    }));
    const existing = await db.collection('emotions').find({ id: { $in: docs.map(d => d.id) } }).project({ id: 1 }).toArray();
    const existingSet = new Set(existing.map(x => x.id));
    const toInsert = docs.filter(d => d.id && !existingSet.has(d.id));
    if (toInsert.length) await db.collection('emotions').insertMany(toInsert);
    res.json({ ok: true, inserted: toInsert.length, skipped: docs.length - toInsert.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/emotion/reset', async (req, res) => {
  try {
    const id = String(req.body.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id requerido' });
    const result = await db.collection('emotions').deleteOne({ id });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/emotion/attend', async (req, res) => {
  try {
    const id = String(req.body.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id requerido' });
    const result = await db.collection('emotions').updateOne({ id }, { $set: { attended: true } });
    res.json({ ok: true, modified: result.modifiedCount });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

async function start() {
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`Conectado a MongoDB → ${DB_NAME}`);
  app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
}
start().catch(err => { console.error('Error al arrancar:', err.message); process.exit(1); });
