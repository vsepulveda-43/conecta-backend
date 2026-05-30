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

try {
  const debugApp = require('./server_debug');
  app.use(debugApp);
} catch (e) {
  console.log('No se encontró o no se pudo cargar server_debug.js');
}

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
    
    if (today) {
      emQuery.$or = [
        { dayKey: today },
        { date: today }
      ];
    }

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

// ENDPOINT CORREGIDO: Mapeo exacto basado en la tabla socioemocional Excel
app.get('/api/remedials', async (req, res) => {
  try {
    const courseId = String(req.query.courseId || '').trim();
    const today = String(req.query.today || '').trim();
    if (!courseId) return res.status(400).json({ ok: false, error: 'courseId es requerido' });

    const emQuery = { courseId };
    if (today) {
      emQuery.$or = [{ dayKey: today }, { date: today }];
    } else {
      const todayStr = new Date().toISOString().split('T')[0];
      emQuery.$or = [{ dayKey: todayStr }, { date: todayStr }];
    }

    const emotions = await db.collection('emotions').find(emQuery).toArray();
    
    if (emotions.length === 0) {
      return res.json({ ok: true, hasData: false, message: 'Aún no se registran emociones para este curso el día de hoy.' });
    }

    const total = emotions.length;
    const negativas = ['Mal 😟', 'Muy mal 😢', 'Enojado 😠'];
    const positivas = ['Muy bien 😄', 'Bien 🙂'];

    let countNeg = 0;
    let countPos = 0;
    let countNeu = 0;
    const freq = {};

    emotions.forEach(e => {
      freq[e.emotion] = (freq[e.emotion] || 0) + 1;
      if (negativas.includes(e.emotion)) countNeg++;
      else if (positivas.includes(e.emotion)) countPos++;
      else countNeu++;
    });

    const pctNeg = Math.round((countNeg / total) * 100);
    const pctPos = Math.round((countPos / total) * 100);
    const pctNeu = Math.round((countNeu / total) * 100);

    let dominantEmotion = '';
    let maxCount = 0;
    for (const em in freq) {
      if (freq[em] > maxCount) {
        maxCount = freq[em];
        dominantEmotion = em;
      }
    }

    let alertLevel = 'low';
    let key = 'positive_stable'; // Por defecto: Feliz / Motivado

    // LÓGICA DE SELECCIÓN DE RECOMENDACIÓN BASADA EN TU TABLA EXCEL
    if (pctNeg >= 40) {
      alertLevel = 'high';
      key = 'critical'; // Nivel Crítico (+40% negativo)
    } else if (dominantEmotion === 'Enojado 😠' || dominantEmotion === 'Muy mal 😢') {
      alertLevel = 'high';
      key = 'negative_high'; // Enojado / Alterado
    } else if (dominantEmotion === 'Mal 😟') {
      alertLevel = 'medium';
      key = 'negative_medium'; // Ansioso / Preocupado
    } else if (pctNeu >= 50 || dominantEmotion === 'Normal 😐') {
      alertLevel = 'medium';
      key = 'neutral_high'; // Neutral / Desmotivado
    }

    const recommendation = await db.collection('recommendations').findOne({ key, active: true });

    res.json({
      ok: true,
      hasData: true,
      totalResponses: total,
      distribution: { positive: pctPos, neutral: pctNeu, negative: pctNeg },
      dominantEmotion,
      alertLevel,
      recommendation: recommendation || {
        title: "Clima Favorable y Refuerzo Positivo",
        description: "La gran mayoría del curso se encuentra estable y con buena energía. Continúa con tus actividades pedagógicas normales.",
        resources: [
          { "label": "Pixabay Música Educativa", "url": "https://pixabay.com/es/music/", "type": "music" },
          { "label": "Convivencia Escolar MINEDUC", "url": "https://convivenciaparaciudadania.mineduc.cl/", "type": "pdf" }
        ]
      }
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    const incoming = req.body.emotions;
    if (!Array.isArray(incoming) || incoming.length === 0) return res.status(400).json({ ok: false, error: 'emotions[] requerido' });
    
    const docs = incoming.map(e => ({
      _id: String(e.id || ''),
      id: String(e.id || ''), 
      studentId: String(e.studentId || ''), 
      studentName: String(e.nombre || e.studentName || ''), 
      nombre: String(e.nombre || e.studentName || ''), 
      emotion: String(e.emotion || ''), 
      emotionGroup: String(e.emotionGroup || ''), 
      source: String(e.source || 'web'), 
      note: String(e.note || ''), 
      courseId: String(e.courseId || ''), 
      courseName: String(e.courseName || ''), 
      sessionId: String(e.sessionId || ''), 
      attended: Boolean(e.attended), 
      registeredAt: new Date(e.registeredAt || new Date()), 
      dayKey: String(e.dayKey || e.date || toPlainDate(e.registeredAt || new Date())), 
      weekKey: String(e.weekKey || ''), 
      monthKey: String(e.monthKey || ''), 
      semesterKey: String(e.semesterKey || ''), 
      yearKey: String(e.yearKey || new Date().getFullYear())
    }));
    
    const existing = await db.collection('emotions').find({ _id: { $in: docs.map(d => d._id) } }).project({ _id: 1 }).toArray();
    const existingSet = new Set(existing.map(x => x._id));
    const toInsert = docs.filter(d => d._id && !existingSet.has(d._id));
    if (toInsert.length) await db.collection('emotions').insertMany(toInsert);
    res.json({ ok: true, inserted: toInsert.length, skipped: docs.length - toInsert.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/emotion/reset', async (req, res) => {
  try {
    const id = String(req.body.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id requerido' });
    const result = await db.collection('emotions').deleteOne({ _id: id });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/emotion/attend', async (req, res) => {
  try {
    const id = String(req.body.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id requerido' });
    const result = await db.collection('emotions').updateOne({ _id: id }, { $set: { attended: true } });
    res.json({ ok: true, modified: result.modifiedCount });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

async function start() {
  await client.connect();
  db = client.db(DB_NAME);
  global.db = db;
  console.log(`Conectado a MongoDB → ${DB_NAME}`);
  app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
}
start().catch(err => { console.error('Error al arrancar:', err.message); process.exit(1); });
