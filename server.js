const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const app = express();
app.use(cors());
app.use(express.json());
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'colegio_cchn';
const API_KEY = process.env.API_KEY || 'change-me';
let client; let db;
async function connectDb(){
  if (!client){
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
  }
  return db;
}
function auth(req,res,next){
  if (req.path === '/health') return next();
  if (req.headers['x-api-key'] !== API_KEY) return res.status(401).json({ok:false,error:'unauthorized'});
  next();
}
app.use(auth);
app.get('/health', async (req,res)=>{
  try { await connectDb(); res.json({ok:true,service:'conecta-backend',db:DB_NAME}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.post('/api/setup', async (req,res)=>res.json({ok:true}));
app.post('/api/import-students', async (req,res)=>res.json({ok:true}));
app.post('/api/login', async (req,res)=>res.json({ok:true,token:'demo'}));
app.post('/api/session', async (req,res)=>res.json({ok:true,sessionId:'demo-session'}));
app.post('/api/emotion', async (req,res)=>res.json({ok:true}));
app.get('/api/summary', async (req,res)=>res.json({ok:true,data:{}}));
const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log(`listening on ${port}`));
