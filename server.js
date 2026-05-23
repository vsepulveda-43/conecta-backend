require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const DB_NAME = process.env.DB_NAME || 'colegio_cchn';
const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) {
  throw new Error('Falta MONGODB_URI');
}

const client = new MongoClient(MONGODB_URI);
let db;

function authMiddleware(req, res, next) {
  const key = req.header('x-api-key');
  if (!API_KEY) return next();
  if (key !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'API key inválida' });
  }
  next();
}

app.use('/api', authMiddleware);

app.get('/health', async (req, res) => {
  try {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    return res.json({
      ok: true,
      dbName: DB_NAME,
      collections: collections.map(c => c.name)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/courses', async (req, res) => {
  try {
    const courses = await db.collection('courses')
      .find({})
      .sort({ name: 1, code: 1 })
      .toArray();

    const normalized = courses.map((c, index) => ({
      id: String(c._id || c.id || ('course-' + index)),
      code: c.code || c.courseId || c.slug || c.name || '',
      name: c.name || c.label || c.courseName || c.code || ('Curso ' + (index + 1))
    }));

    return res.json({
      ok: true,
      courses: normalized
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/students', async (req, res) => {
  try {
    const courseId = String(req.query.courseId || '').trim();

    if (!courseId) {
      return res.status(400).json({ ok: false, error: 'courseId es requerido' });
    }

    const students = await db.collection('users')
      .find({
        role: { $in: ['student', 'alumno', 'estudiante'] },
        $or: [
          { courseId: courseId },
          { courseCode: courseId },
          { course: courseId }
        ]
      })
      .sort({ name: 1, nombre: 1 })
      .toArray();

    const normalized = students.map((s, index) => ({
      id: String(s._id || s.id || s.studentId || ('student-' + index)),
      name: s.name || s.nombre || s.fullName || 'Sin nombre',
      courseId: s.courseId || s.courseCode || s.course || courseId
    }));

    return res.json({
      ok: true,
      courseId,
      students: normalized
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/session', async (req, res) => {
  try {
    const courseId = String(req.body.courseId || '').trim();

    if (!courseId) {
      return res.status(400).json({ ok: false, error: 'courseId es requerido' });
    }

    const doc = {
      courseId,
      createdAt: new Date(),
      active: true
    };

    const result = await db.collection('emotion_sessions').insertOne(doc);

    return res.json({
      ok: true,
      sessionId: String(result.insertedId),
      data: {
        id: String(result.insertedId),
        courseId
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/emotion', async (req, res) => {
  try {
    const studentId = String(req.body.studentId || '').trim();
    const emotion = String(req.body.emotion || '').trim();
    const note = String(req.body.note || '').trim();
    const sessionId = String(req.body.sessionId || '').trim();

    if (!studentId || !emotion || !sessionId) {
      return res.status(400).json({
        ok: false,
        error: 'studentId, emotion y sessionId son requeridos'
      });
    }

    const doc = {
      studentId,
      emotion,
      note,
      sessionId,
      createdAt: new Date()
    };

    const result = await db.collection('emotions').insertOne(doc);

    return res.json({
      ok: true,
      emotionId: String(result.insertedId),
      data: doc
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/summary', async (req, res) => {
  try {
    const courseId = String(req.query.courseId || '').trim();

    if (!courseId) {
      return res.status(400).json({ ok: false, error: 'courseId es requerido' });
    }

    const students = await db.collection('users')
      .find({
        role: { $in: ['student', 'alumno', 'estudiante'] },
        $or: [
          { courseId: courseId },
          { courseCode: courseId },
          { course: courseId }
        ]
      })
      .project({ _id: 1 })
      .toArray();

    const ids = students.map(s => String(s._id));
    const emotions = await db.collection('emotions')
      .find({ studentId: { $in: ids } })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({
      ok: true,
      courseId,
      totalStudents: students.length,
      totalEmotions: emotions.length,
      emotions
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

async function start() {
  await client.connect();
  db = client.db(DB_NAME);
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});

