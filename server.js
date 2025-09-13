// server.js
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const session = require('express-session');
const sanitizeHtml = require('sanitize-html');

const APP_PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'ChangeMe123!'; // غيّر قبل النشر
const FB_PIXEL_ID = process.env.FB_PIXEL_ID || ''; // ضع هنا Pixel ID إذا رغبت

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'takwin_secret_change_me',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 6 }
}));

// serve static files (landing + admin UI)
app.use('/', express.static(path.join(__dirname, 'public')));

// --- Initialize SQLite DB ---
const dbFile = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbFile);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    slug TEXT UNIQUE,
    description TEXT,
    duration TEXT,
    price TEXT,
    image TEXT,
    active INTEGER DEFAULT 1
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT,
    content TEXT,
    active INTEGER DEFAULT 1
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    message TEXT,
    source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // seed sample course (if empty)
  db.get("SELECT COUNT(1) as cnt FROM courses", (err,row)=>{
    if(!err && row.cnt===0){
      db.run(`INSERT INTO courses (title,slug,description,duration,price,image)
        VALUES (?,?,?,?,?,?)`,
        [
          'دورة تكوينية في الحاسوب (مبتدئ -> متوسط)',
          'it-basics',
          'تكوين تطبيقي شامل: أساسيات الحاسوب، أنظمة التشغيل، الأوفيس، وصيانة الأجهزة.',
          '6 أسابيع (مرن)',
          'تحقق عبر المنصة',
          'https://via.placeholder.com/800x450?text=Course+Image'
        ]
      );
    }
  });
});

// --- API: get courses, testimonials, leads ---
app.get('/api/courses', (req,res)=>{
  db.all("SELECT * FROM courses WHERE active=1 ORDER BY id DESC", (err,rows)=>{
    if(err) return res.status(500).json({error:err.message});
    res.json(rows);
  });
});
app.get('/api/testimonials', (req,res)=>{
  db.all("SELECT * FROM testimonials WHERE active=1 ORDER BY id DESC", (err,rows)=>{
    if(err) return res.status(500).json({error:err.message});
    res.json(rows);
  });
});

// public endpoint to store lead (used by landing)
app.post('/api/leads', (req,res)=>{
  const name = sanitizeHtml(req.body.name || '');
  const phone = sanitizeHtml(req.body.phone || '');
  const message = sanitizeHtml(req.body.message || '');
  const source = sanitizeHtml(req.body.source || 'landing');

  if(!phone) return res.status(400).json({error:'phone required'});

  db.run("INSERT INTO leads (name,phone,message,source) VALUES (?,?,?,?)",
    [name,phone,message,source],
    function(err){
      if(err) return res.status(500).json({error:err.message});
      // Optionally: track server-side FB conversions (not implemented here)
      res.json({ok:true,id:this.lastID});
    });
});

// --- Simple Admin auth middleware ---
function requireAuth(req,res,next){
  if(req.session && req.session.user === ADMIN_USER) return next();
  return res.status(401).json({error: 'unauthorized'});
}

// --- Admin login/logout (JSON API) ---
app.post('/admin/login', (req,res)=>{
  const user = req.body.user;
  const pass = req.body.pass;
  if(user===ADMIN_USER && pass===ADMIN_PASS){
    req.session.user = user;
    return res.json({ok:true});
  }
  return res.status(401).json({error:'invalid credentials'});
});
app.post('/admin/logout', (req,res)=>{
  req.session.destroy(()=>res.json({ok:true}));
});

// Admin: manage courses
app.get('/admin/api/courses', requireAuth, (req,res)=>{
  db.all("SELECT * FROM courses ORDER BY id DESC", (err,rows)=>{
    if(err) return res.status(500).json({error:err.message});
    res.json(rows);
  });
});
app.post('/admin/api/courses', requireAuth, (req,res)=>{
  const { title, slug, description, duration, price, image } = req.body;
  db.run("INSERT INTO courses (title,slug,description,duration,price,image) VALUES (?,?,?,?,?,?)",
    [title,slug,description,duration,price,image],
    function(err){ if(err) return res.status(500).json({error:err.message}); res.json({ok:true,id:this.lastID}); });
});
app.put('/admin/api/courses/:id', requireAuth, (req,res)=>{
  const id = +req.params.id;
  const { title, slug, description, duration, price, image, active } = req.body;
  db.run("UPDATE courses SET title=?,slug=?,description=?,duration=?,price=?,image=?,active=? WHERE id=?",
    [title,slug,description,duration,price,image,active?1:0,id],
    function(err){ if(err) return res.status(500).json({error:err.message}); res.json({ok:true,changes:this.changes}); });
});
app.delete('/admin/api/courses/:id', requireAuth, (req,res)=>{
  const id = +req.params.id;
  db.run("DELETE FROM courses WHERE id=?", [id], function(err){ if(err) return res.status(500).json({error:err.message}); res.json({ok:true}); });
});

// Admin: testimonials
app.get('/admin/api/testimonials', requireAuth, (req,res)=>{
  db.all("SELECT * FROM testimonials ORDER BY id DESC", (err,rows)=>{ if(err) return res.status(500).json({error:err.message}); res.json(rows);});
});
app.post('/admin/api/testimonials', requireAuth, (req,res)=>{
  const { author, content } = req.body;
  db.run("INSERT INTO testimonials (author,content) VALUES (?,?)", [author,content], function(err){ if(err) return res.status(500).json({error:err.message}); res.json({ok:true,id:this.lastID}); });
});
app.put('/admin/api/testimonials/:id', requireAuth, (req,res)=>{
  const id = +req.params.id; const { author,content,active } = req.body;
  db.run("UPDATE testimonials SET author=?,content=?,active=? WHERE id=?", [author,content,active?1:0,id], function(err){ if(err) return res.status(500).json({error:err.message}); res.json({ok:true}); });
});
app.delete('/admin/api/testimonials/:id', requireAuth, (req,res)=>{
  const id = +req.params.id; db.run("DELETE FROM testimonials WHERE id=?", [id], function(err){ if(err) return res.status(500).json({error:err.message}); res.json({ok:true}); });
});

// Admin: view leads
app.get('/admin/api/leads', requireAuth, (req,res)=>{
  db.all("SELECT * FROM leads ORDER BY created_at DESC", (err,rows)=>{ if(err) return res.status(500).json({error:err.message}); res.json(rows);});
});

// Serve admin UI (single page) - placed in /public/admin.html
// (public folder already served above)

// Start server
app.listen(APP_PORT, ()=> console.log(`Server running on http://localhost:${APP_PORT} (FB_PIXEL:${FB_PIXEL_ID? 'set':'not-set'})`));
