require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

// ── Configuración ──────────────────────────────────────────────
const PORT        = process.env.PORT        || 3000;
const API_KEY     = process.env.API_KEY     || '';
const DB_NAME     = process.env.DB_NAME     || 'colegio_cchn';
const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en variables de entorno');

const client = new MongoClient(MONGODB_URI);
let db;

// ── Middleware de autenticación ────────────────────────────────
function auth(req, res, next) {
  if (!API_KEY) return next();                          // sin clave → libre
  if (req.header('x-api-key') !== API_KEY)
    return res.status(401).json({ ok: false, error: 'API key inválida' });
  next();
}
app.use('/api', auth);

// ──────────────────────────────────────────────────────────────
// GET /health
// Verifica que el servidor y la DB estén vivos.
// ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    res.json({ ok: true, dbName: DB_NAME, collections: cols.map(c => c.name) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/data
// Devuelve todos los alumnos y todas las emociones.
// El frontend lo llama al iniciar sesión (modo real) y en el kiosco.
//
// Respuesta esperada por el frontend:
// {
//   ok: true,
//   users:    [ { id, nombre, curso } ],
//   emotions: [ { id, studentId, nombre, emotion, date, attended } ]
// }
// ──────────────────────────────────────────────────────────────
app.get('/api/data', async (req, res) => {
  try {
    // ── Alumnos ──────────────────────────────────────────────
    const rawUsers = await db.collection('users')
      .find({ role: { $in: ['student', 'alumno', 'estudiante'] } })
      .sort({ nombre: 1, name: 1 })
      .toArray();

    const users = rawUsers.map(u => ({
      id:     String(u._id),
      nombre: u.nombre || u.name || 'Sin nombre',
      curso:  u.curso  || u.courseId || u.course || ''
    }));

    // ── Emociones ────────────────────────────────────────────
    const rawEmotions = await db.collection('emotions')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const emotions = rawEmotions.map(e => ({
      id:        String(e._id),
      studentId: String(e.studentId),
      nombre:    e.nombre    || '',
      emotion:   e.emotion   || '',
      date:      e.date      || (e.createdAt
                    ? e.createdAt.toISOString().split('T')[0]
                    : ''),
      attended:  e.attended  || false
    }));

    res.json({ ok: true, users, emotions });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/sync
// Guarda una o varias emociones nuevas enviadas desde el kiosco.
//
// Body esperado: { emotions: [ { id, studentId, nombre, emotion, date, attended } ] }
// El frontend ya genera el campo "id" (ej: "em_1716000000_st_3").
// Lo guardamos como campo propio para poder buscarlo después.
// ──────────────────────────────────────────────────────────────
app.post('/api/sync', async (req, res) => {
  try {
    const incoming = req.body.emotions;
    if (!Array.isArray(incoming) || incoming.length === 0)
      return res.status(400).json({ ok: false, error: 'emotions[] requerido' });

    const docs = incoming.map(e => ({
      id:        String(e.id        || ''),
      studentId: String(e.studentId || ''),
      nombre:    String(e.nombre    || ''),
      emotion:   String(e.emotion   || ''),
      date:      String(e.date      || ''),
      attended:  Boolean(e.attended),
      createdAt: new Date()
    }));

    // Evitar duplicados: si ya existe ese id, no insertamos de nuevo
    const existingIds = await db.collection('emotions')
      .find({ id: { $in: docs.map(d => d.id) } })
      .project({ id: 1 })
      .toArray()
      .then(r => new Set(r.map(x => x.id)));

    const toInsert = docs.filter(d => !existingIds.has(d.id));
    if (toInsert.length > 0)
      await db.collection('emotions').insertMany(toInsert);

    res.json({ ok: true, inserted: toInsert.length, skipped: docs.length - toInsert.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/emotion/reset
// Elimina una emoción del día para que el alumno pueda volver a registrar.
//
// Body esperado: { id: "em_..." }
// ──────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────
// POST /api/emotion/attend
// Marca una emoción como atendida (para cerrar alertas).
//
// Body esperado: { id: "em_..." }
// ──────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────
// Arranque
// ──────────────────────────────────────────────────────────────
async function start() {
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`Conectado a MongoDB → ${DB_NAME}`);
  app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
}

start().catch(err => {
  console.error('Error al arrancar:', err.message);
  process.exit(1);
});
