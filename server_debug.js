const express = require('express');
const app = express();
app.get('/api/debug', async (req,res)=>{
  try {
    const db = global.db;
    const out = {};
    for (const name of ['courses','users','emotions','emotion_sessions']) {
      out[name] = await db.collection(name).find({}).limit(3).toArray();
    }
    res.json({ ok:true, sample: out });
  } catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
module.exports = app;
