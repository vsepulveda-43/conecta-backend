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
  if (req.header('x-api-key') !== API_KEY)
    return res.status(401).json({ ok: false, error: 'API key inválida' });
  next();
}
app.use('/api', auth);

// ── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    res.json({ ok: true, dbName: DB_NAME, collections: cols.map(c => c.name) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/courses ─────────────────────────────────────────────────────────
// Respuesta: { ok, courses: [ { id, name } ] }
app.get('/api/courses', async (req, res) => {
  try {
    const raw = await db.collection('courses')
      .find({ active: true })
      .sort({ name: 1 })
      .toArray();
    const courses = raw.map(c => ({ id: String(c._id), name: c.name || String(c._id) }));
    res.json({ ok: true, courses });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/data?courseId=c7a ────────────────────────────────────────────────
// Respuesta: { ok, courseId, courseName, users, emotions }
// users:    [ { id, nombre, curso, courseId } ]
// emotions: [ { id, studentId, nombre, emotion, date, attended, courseId } ]
app.get('/api/data', async (req, res) => {
  try {
    const courseId = String(req.query.courseId || '').trim();
    const today    = req.query.today || '';   // opcional: filtra emociones del día

    // Alumnos
    const userQuery = { role: 'student', active: true };
    if (courseId) userQuery.courseId = courseId;

    const rawUsers = await db.collection('users')
      .find(userQuery)
      .sort({ listNumber: 1, name: 1 })
      .toArray();

    const users = rawUsers.map(u => ({
      id:       String(u._id),
      nombre:   u.name || 'Sin nombre',
      curso:    u.courseName || u.courseId || '',
      courseId: u.courseId || ''
    }));

    // Nombre del curso
    let courseName = '';
    if (courseId) {
      const course = await db.collection('courses').findOne({ _id: courseId });
      courseName = course ? (course.name || courseId) : courseId;
    }

    // Emociones — usa el campo "id" (generado por el frontend / kiosco)
    const emQuery = {};
    if (courseId) emQuery.courseId = courseId;
    if (today)    emQuery.date = today;

    const rawEmotions = await db.collection('emotions')
      .find(emQuery)
      .sort({ createdAt: -1 })
      .toArray();

    const emotions = rawEmotions.map(e => ({
      // Preferimos el campo "id" que generó el kiosco; si no existe usamos _id
      id:        e.id || String(e._id),
      studentId: String(e.studentId),
      nombre:    e.nombre || e.studentName || '',
      emotion:   e.emotion || '',
      date:      e.date || (e.createdAt ? e.createdAt.toISOString().split('T')[0] : ''),
      attended:  e.attended || false,
      courseId:  e.courseId || ''
    }));

    res.json({ ok: true, courseId, courseName, users, emotions });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/sync ───────────────────────────────────────────────────────────
// Body: { emotions: [ { id, studentId, nombre, emotion, date, courseId } ] }
// Anti-duplicado por campo "id" del frontend
app.post('/api/sync', async (req, res) => {
  try {
    const incoming = req.body.emotions;
    if (!Array.isArray(incoming) || incoming.length === 0)
      return res.status(400).json({ ok: false, error: 'emotions[] requerido' });

    const docs = incoming.map(e => ({
      id:        String(e.id || ''),
      studentId: String(e.studentId || ''),
      nombre:    String(e.nombre || ''),
      emotion:   String(e.emotion || ''),
      date:      String(e.date || new Date().toISOString().split('T')[0]),
      courseId:  String(e.courseId || ''),
      attended:  Boolean(e.attended),
      createdAt: new Date()
    }));

    // Evitar duplicados
    const existing = await db.collection('emotions')
      .find({ id: { $in: docs.map(d => d.id) } })
      .project({ id: 1 })
      .toArray();
    const existingSet = new Set(existing.map(x => x.id));
    const toInsert = docs.filter(d => !existingSet.has(d.id));

    if (toInsert.length > 0)
      await db.collection('emotions').insertMany(toInsert);

    res.json({ ok: true, inserted: toInsert.length, skipped: docs.length - toInsert.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/emotion/reset ──────────────────────────────────────────────────
// Body: { id: "em_..." }
app.post('/api/emotion/reset', async (req, res) => {
  try {
    const id = String(req.body.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id requerido' });
    const result = await db.collection('emotions').deleteOne({ id });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/emotion/attend ─────────────────────────────────────────────────
// Body: { id: "em_..." }
app.post('/api/emotion/attend', async (req, res) => {
  try {
    const id = String(req.body.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id requerido' });
    const result = await db.collection('emotions')
      .updateOne({ id }, { $set: { attended: true } });
    res.json({ ok: true, modified: result.modifiedCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Arranque ─────────────────────────────────────────────────────────────────
async function start() {
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`Conectado a MongoDB → ${DB_NAME}`);
  app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
}
start().catch(err => { console.error('Error al arrancar:', err.message); process.exit(1); });
