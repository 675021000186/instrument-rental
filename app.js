require('dotenv').config();
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const helpers = require('./lib/helpers');
const DEMO = require('./lib/demo');
const { writeLog } = require('./lib/log');
const { MAX_MB } = require('./lib/upload');
const { prepare, loadUser, csrfGuard, text, isApi } = require('./middleware');

if (!process.env.SESSION_SECRET) throw new Error('กรุณาตั้ง SESSION_SECRET ในไฟล์ .env');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
Object.assign(app.locals, helpers, { maxMb: MAX_MB });

app.use(express.urlencoded({ extended: false }));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false, // ยังไม่ล็อกอิน = ไม่สร้าง Session (MemoryStore: รีสตาร์ตแล้วต้องล็อกอินใหม่)
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 1000 }
}));
app.use(prepare);
app.use(loadUser);
app.use(csrfGuard);

const demoList = () => process.env.SHOW_DEMO_ACCOUNTS === 'true' ? DEMO : [];
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

app.get('/', (req, res) => res.redirect(req.user ? '/app' : '/login'));

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/app');
  res.render('login', { error: '', demo: DEMO });
});

app.post('/login', async (req, res, next) => {
  const username = text(req.body.username).slice(0, 50);
  const r = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  const u = r.rows[0];
  const ok = await bcrypt.compare(String(req.body.password || ''), u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok || !u.is_active) {
    await writeLog(req, 'login.failure', { resource: 'auth', result: 'failure', username,
      detail: !u ? 'ไม่พบชื่อบัญชี' : !ok ? 'รหัสผ่านไม่ถูกต้อง' : 'บัญชีถูกปิดการใช้งาน' });
    return res.status(401).render('login', { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', demo: demoList() });
  }
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.userId = u.user_id;
    req.session.save(async err2 => {
      if (err2) return next(err2);
      await writeLog(req, 'login.success', { resource: 'auth', userId: u.user_id, username: u.username });
      res.redirect('/app');
    });
  });
});

app.post('/logout', async (req, res, next) => {
  if (req.user) await writeLog(req, 'logout', { resource: 'auth' });
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

app.use('/app', require('./routes/app'));      // ส่วนผู้ใช้ทั่วไป
app.use('/admin', require('./routes/admin'));  // ส่วน Admin (แยกกลุ่ม Route/เมนู/การตรวจสิทธิ์)
app.use('/api', require('./routes/api'));      // API (ตรวจสิทธิ์ฝั่ง Server เช่นเดียวกัน)

app.use((req, res) => {
  if (isApi(req)) return res.status(404).json({ error: 'Not found' });
  res.status(404).render('error', { title: 'ไม่พบหน้า', status: 404, message: 'ไม่พบหน้าที่ต้องการ' });
});

app.use((err, req, res, next) => {
  const known = {
    '23505': 'ข้อมูลซ้ำ (เช่น ชื่อซ้ำ หรือกำหนดสิทธิ์ซ้ำ)',
    '23503': 'ข้อมูลนี้ยังถูกใช้งานอยู่ หรือข้อมูลอ้างอิงไม่มีอยู่จริง',
    '23502': 'กรอกข้อมูลไม่ครบ',
    '23514': 'ค่าที่กรอกไม่ผ่านเงื่อนไขของระบบ',
    '22P02': 'ชนิดข้อมูลไม่ถูกต้อง',
    '22007': 'รูปแบบวันที่ไม่ถูกต้อง',
    '22008': 'รูปแบบวันที่ไม่ถูกต้อง'
  };
  let status = 500, message = 'เกิดข้อผิดพลาดของระบบ';
  if (known[err.code]) { status = 400; message = known[err.code]; }
  else if (err.code === 'LIMIT_FILE_SIZE') {
    status = 400; message = `ไฟล์ใหญ่เกินกำหนด (ไม่เกิน ${MAX_MB} MB)`;
    writeLog(req, 'file.upload', { resource: 'file', result: 'failure', detail: message });
  } else if (err.name === 'MulterError') { status = 400; message = 'อัปโหลดไฟล์ไม่สำเร็จ'; }
  else if (err.status) { status = err.status; message = err.message; }
  console.error(req.method, req.originalUrl, err.code || err.message);
  if (res.headersSent) return next(err);
  if (isApi(req)) return res.status(status).json({ error: message });
  res.status(status).render('error', { title: 'เกิดข้อผิดพลาด', status, message });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`เปิด http://localhost:${port}/login`));
}

module.exports = app;
