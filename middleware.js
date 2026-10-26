const crypto = require('node:crypto');
const pool = require('./db');
const { writeLog } = require('./lib/log');

const isApi = req => req.originalUrl.startsWith('/api/');
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };

// ค่าเริ่มต้นให้ทุก View + CSRF token + flash message
function prepare(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.user = null;
  res.locals.can = () => false;
  res.locals.isAdmin = false;
  res.locals.currentPath = req.originalUrl.split('?')[0];
  req.user = null;
  req.can = () => false;
  next();
}

// โหลดผู้ใช้ + Role + Permission จากฐานข้อมูล "ทุกคำขอ" => เปลี่ยน Role/ACL มีผลทันที ไม่ต้องรีสตาร์ต
async function loadUser(req, res, next) {
  const id = req.session.userId;
  if (!id) return next();
  const r = await pool.query(
    `SELECT u.user_id,u.username,u.full_name,u.is_active,u.role_id,r.role_name
     FROM users u JOIN roles r USING (role_id) WHERE u.user_id=$1`, [id]);
  const u = r.rows[0];
  if (!u || !u.is_active) {
    return req.session.destroy(() => {
      if (isApi(req)) return res.status(401).json({ error: 'Account disabled or removed' });
      res.redirect('/login');
    });
  }
  const p = await pool.query(
    `SELECT p.permission_name FROM role_permissions rp
     JOIN permissions p USING (permission_id) WHERE rp.role_id=$1`, [u.role_id]);
  const set = new Set(p.rows.map(x => x.permission_name));
  const isAdmin = u.role_name === 'admin'; // Admin ใช้ได้ทุกฟังก์ชัน รวมฟังก์ชันที่เพิ่มภายหลัง
  req.user = u;
  req.isAdmin = isAdmin;
  req.can = name => isAdmin || set.has(name);
  res.locals.user = u;
  res.locals.can = req.can;
  res.locals.isAdmin = isAdmin;
  next();
}

async function csrfVerify(req, res, next) {
  const sent = Buffer.from(String((req.body && req.body._csrf) || ''));
  const real = Buffer.from(req.session.csrf || '');
  if (sent.length !== real.length || !crypto.timingSafeEqual(sent, real)) {
    await writeLog(req, 'csrf.invalid', { resource: req.originalUrl.split('?')[0], result: 'denied', detail: 'invalid form token' });
    return res.status(403).render('error', { title: 'แบบฟอร์มไม่ถูกต้อง', status: 403,
      message: 'แบบฟอร์มหมดอายุหรือโทเค็นไม่ถูกต้อง กรุณารีโหลดหน้าแล้วลองใหม่' });
  }
  next();
}
// multipart (อัปโหลดไฟล์) ต้องให้ multer อ่านก่อน แล้ว Route เรียก csrfVerify ต่อเอง
function csrfGuard(req, res, next) {
  if (req.method === 'POST' && !req.is('multipart/form-data')) return csrfVerify(req, res, next);
  next();
}

async function forbidden(req, res, need) {
  await writeLog(req, 'access.denied', { resource: req.originalUrl.split('?')[0], result: 'denied', detail: `${req.method} ต้องมีสิทธิ์: ${need}` });
  if (isApi(req)) return res.status(403).json({ error: 'Forbidden', required: need });
  return res.status(403).render('error', { title: 'ไม่มีสิทธิ์เข้าถึง', status: 403,
    message: `บัญชีของคุณไม่มีสิทธิ์ใช้งานส่วนนี้ (ต้องมีสิทธิ์: ${need})` });
}
function notLoggedIn(req, res) {
  if (isApi(req)) return res.status(401).json({ error: 'Login required' });
  return res.redirect('/login');
}
function requireLogin(req, res, next) { return req.user ? next() : notLoggedIn(req, res); }
function requirePermission(name) {
  return (req, res, next) => !req.user ? notLoggedIn(req, res) : req.can(name) ? next() : forbidden(req, res, name);
}
function requireAny(...names) {
  return (req, res, next) => !req.user ? notLoggedIn(req, res) : names.some(n => req.can(n)) ? next() : forbidden(req, res, names.join(' หรือ '));
}

function validId(v) { const n = Number(v); return Number.isSafeInteger(n) && n > 0 && n <= 2147483647; }
function bad(message) { const e = new Error(message); e.status = 400; throw e; }
function text(v) { return String(v || '').trim(); }

module.exports = { prepare, loadUser, csrfVerify, csrfGuard, forbidden, requireLogin, requirePermission,
  requireAny, validId, bad, text, flash, isApi };
