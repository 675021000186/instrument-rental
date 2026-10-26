const router = require('express').Router();
const pool = require('../db');
const { requireLogin, requirePermission, requireAny, forbidden, csrfVerify, validId, bad, text, flash } = require('../middleware');
const { writeLog } = require('../lib/log');
const { upload, detect, saveBuffer, filePath, removeFile, cleanName } = require('../lib/upload');
const { isCategory, todayStr, addDays, isDate } = require('../lib/helpers');
const getSummary = require('../lib/report');

router.use(requireLogin);
router.param('id', (req, res, next, id) => {
  if (!validId(id)) return res.status(400).render('error', { title: 'ข้อมูลไม่ถูกต้อง', status: 400, message: 'รหัสไม่ถูกต้อง' });
  next();
});

/* ---------- Dashboard ---------- */
router.get('/', async (req, res) => {
  const all = req.can('rental.read.all'), own = req.can('rental.read.own');
  const stats = [];
  if (req.can('instrument.read')) {
    const r = await pool.query('SELECT COUNT(*)::int c, COALESCE(SUM(stock),0)::int s FROM instruments');
    stats.push({ label: 'รายการเครื่องดนตรี', value: r.rows[0].c, href: '/app/instruments' });
    stats.push({ label: 'ชิ้นที่พร้อมให้เช่า', value: r.rows[0].s, href: '/app/instruments' });
  }
  if (all || own) {
    const r = await pool.query(
      'SELECT status, COUNT(*)::int c FROM rentals WHERE ($1::boolean OR user_id=$2) GROUP BY status', [all, req.user.user_id]);
    const m = Object.fromEntries(r.rows.map(x => [x.status, x.c]));
    stats.push({ label: all ? 'คำขอรออนุมัติ' : 'คำขอที่รออนุมัติ', value: m.pending || 0, href: '/app/rentals?status=pending' });
    stats.push({ label: 'กำลังเช่าอยู่', value: m.picked_up || 0, href: '/app/rentals?status=picked_up' });
  }
  res.render('dashboard', { stats });
});

/* ---------- Instruments ---------- */
function parseInstrument(b) {
  const name = text(b.name);
  if (!name || name.length > 100) bad('ชื่อเครื่องดนตรีไม่ถูกต้อง (1–100 ตัวอักษร)');
  if (!isCategory(b.category)) bad('หมวดหมู่ไม่ถูกต้อง');
  const description = text(b.description);
  if (description.length > 500) bad('คำอธิบายยาวเกิน 500 ตัวอักษร');
  const price = Number(b.daily_price);
  if (!(price > 0 && price <= 100000)) bad('ราคาต่อวันต้องมากกว่า 0 และไม่เกิน 100,000');
  const stock = Number(b.stock);
  if (!Number.isInteger(stock) || stock < 0 || stock > 1000) bad('จำนวนต้องเป็นจำนวนเต็ม 0–1000');
  return [name, b.category, description, price, stock];
}

router.get('/instruments', requirePermission('instrument.read'), async (req, res) => {
  const q = text(req.query.q).slice(0, 100);
  const category = isCategory(req.query.category) ? req.query.category : '';
  const r = await pool.query(
    `SELECT i.*, (SELECT file_id FROM files f WHERE f.instrument_id=i.instrument_id
        AND f.mime_type LIKE 'image/%' ORDER BY file_id LIMIT 1) AS image_id
     FROM instruments i
     WHERE ($1='' OR i.name ILIKE '%' || $1 || '%') AND ($2='' OR i.category=$2)
     ORDER BY i.name`, [q, category]);
  res.render('instruments-list', { rows: r.rows, q, category });
});
router.get('/instruments/new', requirePermission('instrument.create'), (req, res) => {
  res.render('instruments-form', { row: null });
});
router.post('/instruments', requirePermission('instrument.create'), async (req, res) => {
  const v = parseInstrument(req.body);
  const r = await pool.query(
    'INSERT INTO instruments (name,category,description,daily_price,stock) VALUES ($1,$2,$3,$4,$5) RETURNING instrument_id', v);
  await writeLog(req, 'instrument.create', { resource: 'instrument', resourceId: r.rows[0].instrument_id, detail: v[0] });
  flash(req, 'ok', 'เพิ่มเครื่องดนตรีเรียบร้อย');
  res.redirect('/app/instruments/' + r.rows[0].instrument_id);
});
router.get('/instruments/:id', requirePermission('instrument.read'), async (req, res) => {
  const r = await pool.query('SELECT * FROM instruments WHERE instrument_id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).render('error', { title: 'ไม่พบข้อมูล', status: 404, message: 'ไม่พบเครื่องดนตรี' });
  const images = req.can('file.read')
    ? (await pool.query(`SELECT file_id FROM files WHERE instrument_id=$1 AND mime_type LIKE 'image/%' ORDER BY file_id`, [req.params.id])).rows : [];
  res.render('instrument-detail', { i: r.rows[0], images, today: todayStr() });
});
router.get('/instruments/:id/edit', requirePermission('instrument.update'), async (req, res) => {
  const r = await pool.query('SELECT * FROM instruments WHERE instrument_id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).render('error', { title: 'ไม่พบข้อมูล', status: 404, message: 'ไม่พบเครื่องดนตรี' });
  res.render('instruments-form', { row: r.rows[0] });
});
router.post('/instruments/:id/update', requirePermission('instrument.update'), async (req, res) => {
  const v = parseInstrument(req.body);
  const ver = Number(req.body.version);
  if (!Number.isInteger(ver) || ver < 1) bad('ข้อมูลฟอร์มไม่ครบ กรุณาเปิดหน้าแก้ไขใหม่');
  const r = await pool.query(
    `UPDATE instruments SET name=$1,category=$2,description=$3,daily_price=$4,stock=$5,version=version+1
     WHERE instrument_id=$6 AND version=$7`, [...v, req.params.id, ver]);
  if (!r.rowCount) bad('ข้อมูลเครื่องนี้เพิ่งถูกเปลี่ยนโดยผู้อื่น (เช่น สต็อกถูกตัด) กรุณาเปิดหน้าแก้ไขใหม่แล้วบันทึกอีกครั้ง');
  await writeLog(req, 'instrument.update', { resource: 'instrument', resourceId: req.params.id, detail: v[0] });
  flash(req, 'ok', 'บันทึกการแก้ไขแล้ว');
  res.redirect('/app/instruments/' + req.params.id);
});
router.post('/instruments/:id/delete', requirePermission('instrument.delete'), async (req, res) => {
  const files = (await pool.query('SELECT stored_name FROM files WHERE instrument_id=$1', [req.params.id])).rows;
  const r = await pool.query('DELETE FROM instruments WHERE instrument_id=$1 RETURNING name', [req.params.id]); // มีประวัติเช่า => FK ปฏิเสธ
  if (!r.rowCount) bad('ไม่พบเครื่องดนตรี');
  for (const f of files) await removeFile(f.stored_name);
  await writeLog(req, 'instrument.delete', { resource: 'instrument', resourceId: req.params.id, detail: r.rows[0].name });
  flash(req, 'ok', 'ลบเครื่องดนตรีแล้ว');
  res.redirect('/app/instruments');
});

/* ---------- Rentals (กระบวนการหลัก: ส่งคำขอ → อนุมัติ/ปฏิเสธ → ส่งมอบ → รับคืน) ---------- */
router.get('/rentals', requireAny('rental.read.all', 'rental.read.own'), async (req, res) => {
  const all = req.can('rental.read.all');
  const status = Object.hasOwn(require('../lib/helpers').STATUS, req.query.status) ? req.query.status : '';
  const r = await pool.query(
    `SELECT r.rental_id,r.user_id,r.start_date,r.days,r.total_price,r.status,
            i.name AS instrument_name,i.category,u.full_name
     FROM rentals r JOIN instruments i USING (instrument_id) JOIN users u ON u.user_id=r.user_id
     WHERE ($1::boolean OR r.user_id=$2) AND ($3='' OR r.status=$3)
     ORDER BY r.rental_id DESC`, [all, req.user.user_id, status]);
  res.render('rentals-list', { rows: r.rows, all, status });
});

router.post('/rentals', requirePermission('rental.create'), async (req, res) => {
  const iid = req.body.instrument_id;
  if (!validId(iid)) bad('เลือกเครื่องดนตรีไม่ถูกต้อง');
  const days = Number(req.body.days);
  if (!Number.isInteger(days) || days < 1 || days > 30) bad('จำนวนวันต้องอยู่ระหว่าง 1–30');
  const start = String(req.body.start_date || '');
  if (!isDate(start) || start < todayStr() || start > addDays(60)) bad('วันที่เริ่มเช่าไม่ถูกต้อง (ห้ามย้อนหลัง และไม่เกิน 60 วันข้างหน้า)');
  const note = text(req.body.note);
  if (note.length > 255) bad('หมายเหตุยาวเกิน 255 ตัวอักษร');
  const inst = (await pool.query('SELECT * FROM instruments WHERE instrument_id=$1', [iid])).rows[0];
  if (!inst) bad('ไม่พบเครื่องดนตรี');
  if (inst.stock < 1) bad('เครื่องนี้หมดชั่วคราว');
  let r;
  try {
    r = await pool.query(
      `INSERT INTO rentals (user_id,instrument_id,start_date,days,total_price,note)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING rental_id`,
      [req.user.user_id, iid, start, days, Number(inst.daily_price) * days, note]);
  } catch (e) {
    if (e.code === '23505') bad('คุณมีคำขอเช่าเครื่องนี้ที่รออนุมัติอยู่แล้ว');
    throw e;
  }
  await writeLog(req, 'rental.create', { resource: 'rental', resourceId: r.rows[0].rental_id, detail: `${inst.name} × ${days} วัน` });
  flash(req, 'ok', 'ส่งคำขอเช่าเรียบร้อย กรุณารอการอนุมัติ');
  res.redirect('/app/rentals/' + r.rows[0].rental_id);
});

async function loadRental(id) {
  return (await pool.query(
    `SELECT r.*, i.name AS instrument_name, i.category, u.full_name, u.username, rv.full_name AS reviewer
     FROM rentals r JOIN instruments i USING (instrument_id)
     JOIN users u ON u.user_id=r.user_id LEFT JOIN users rv ON rv.user_id=r.reviewed_by
     WHERE r.rental_id=$1`, [id])).rows[0];
}

router.get('/rentals/:id', requireAny('rental.read.all', 'rental.read.own'), async (req, res) => {
  const r = await loadRental(req.params.id);
  if (!r) return res.status(404).render('error', { title: 'ไม่พบข้อมูล', status: 404, message: 'ไม่พบรายการเช่า' });
  if (r.user_id !== req.user.user_id && !req.can('rental.read.all')) return forbidden(req, res, 'เจ้าของรายการเท่านั้น (หรือ rental.read.all)');
  const files = req.can('file.read')
    ? (await pool.query(`SELECT f.*, u.username FROM files f JOIN users u ON u.user_id=f.uploaded_by
                         WHERE f.rental_id=$1 ORDER BY f.file_id`, [r.rental_id])).rows : [];
  const logs = req.can('log.read')
    ? (await pool.query(`SELECT * FROM audit_logs WHERE resource='rental' AND resource_id=$1 ORDER BY log_id DESC LIMIT 15`, [String(r.rental_id)])).rows : [];
  res.render('rental-detail', { r, files, logs });
});

const ACTIONS = {
  approve: { perm: 'rental.approve', from: ['pending'], to: 'approved', stock: -1, label: 'อนุมัติ' },
  reject: { perm: 'rental.approve', from: ['pending'], to: 'rejected', stock: 0, label: 'ปฏิเสธ' },
  pickup: { perm: 'rental.update_status', from: ['approved'], to: 'picked_up', stock: 0, label: 'ส่งมอบเครื่อง' },
  return: { perm: 'rental.update_status', from: ['picked_up'], to: 'returned', stock: 1, label: 'รับคืนเครื่อง' },
  cancel: { perm: null, from: ['pending', 'approved'], to: 'cancelled', stock: 0, label: 'ยกเลิก' }
};

router.post('/rentals/:id/:action', async (req, res) => {
  const a = req.params.action;
  if (!Object.hasOwn(ACTIONS, a)) return res.status(404).render('error', { title: 'ไม่พบหน้า', status: 404, message: 'ไม่พบการกระทำนี้' });
  const def = ACTIONS[a];
  const client = await pool.connect();
  let denied = null, back = '/app/rentals/' + req.params.id;
  try {
    await client.query('BEGIN');
    const r = (await client.query('SELECT * FROM rentals WHERE rental_id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!r) { const e = new Error('ไม่พบรายการเช่า'); e.status = 404; throw e; }
    const isOwner = r.user_id === req.user.user_id;
    const allowed = a === 'cancel'
      ? (req.can('rental.update_status') || (isOwner && req.can('rental.cancel.own') && r.status === 'pending'))
      : req.can(def.perm);
    if (!allowed) {
      denied = a === 'cancel' ? 'rental.update_status หรือ (เจ้าของ + rental.cancel.own)' : def.perm;
      await client.query('ROLLBACK');
    } else {
      if (!def.from.includes(r.status)) bad('สถานะปัจจุบันไม่สามารถทำรายการนี้ได้');
      let delta = def.stock;
      if (a === 'cancel' && r.status === 'approved') delta = 1; // คืนสต็อกที่จองไว้
      if (delta < 0) {
        const s = await client.query('UPDATE instruments SET stock=stock-1,version=version+1 WHERE instrument_id=$1 AND stock>0', [r.instrument_id]);
        if (!s.rowCount) bad('สต็อกไม่พอสำหรับอนุมัติ');
      } else if (delta > 0) {
        await client.query('UPDATE instruments SET stock=stock+1,version=version+1 WHERE instrument_id=$1', [r.instrument_id]);
      }
      const reviewer = ['approve', 'reject'].includes(a) ? req.user.user_id : r.reviewed_by;
      await client.query('UPDATE rentals SET status=$1,reviewed_by=$2,updated_at=now() WHERE rental_id=$3', [def.to, reviewer, r.rental_id]);
      await client.query('COMMIT');
    }
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  if (denied) return forbidden(req, res, denied);
  await writeLog(req, 'rental.' + a, { resource: 'rental', resourceId: req.params.id, detail: def.label });
  flash(req, 'ok', `ทำรายการ "${def.label}" เรียบร้อย`);
  const fromList = /\/app\/rentals(\?.*)?$/.test(req.get('referer') || '');
  res.redirect(fromList ? '/app/rentals' : back);
});

/* ---------- Files ---------- */
async function rejectUpload(req, msg) {
  await writeLog(req, 'file.upload', { resource: 'file', result: 'failure', detail: msg });
  bad(msg);
}

router.post('/files/upload', requirePermission('file.upload'), upload.single('file'), csrfVerify, async (req, res) => {
  const type = req.body.target, id = req.body.target_id;
  if (!['instrument', 'rental'].includes(type) || !validId(id)) bad('ข้อมูลปลายทางไม่ถูกต้อง');
  let back;
  if (type === 'instrument') {
    if (!req.can('instrument.update')) return forbidden(req, res, 'instrument.update (อัปโหลดรูปเครื่องดนตรี)');
    if (!(await pool.query('SELECT 1 FROM instruments WHERE instrument_id=$1', [id])).rowCount) bad('ไม่พบเครื่องดนตรี');
    back = '/app/instruments/' + id;
  } else {
    const r = (await pool.query('SELECT user_id FROM rentals WHERE rental_id=$1', [id])).rows[0];
    if (!r) bad('ไม่พบรายการเช่า');
    if (r.user_id !== req.user.user_id && !req.can('rental.read.all')) return forbidden(req, res, 'เจ้าของรายการเท่านั้น (หรือ rental.read.all)');
    back = '/app/rentals/' + id;
  }
  if (!req.file) await rejectUpload(req, 'กรุณาเลือกไฟล์ก่อนอัปโหลด');
  const kind = detect(req.file.buffer);
  if (!kind) await rejectUpload(req, 'ชนิดไฟล์ไม่รองรับ (รองรับ JPG, PNG, WebP, PDF)');
  if (type === 'instrument' && !kind.mime.startsWith('image/')) await rejectUpload(req, 'รูปเครื่องดนตรีต้องเป็นไฟล์ภาพเท่านั้น');
  const stored = await saveBuffer(req.file.buffer, kind.ext);
  const original = cleanName(req.file.originalname);
  try {
    await pool.query(
      `INSERT INTO files (original_name,stored_name,mime_type,size_bytes,uploaded_by,instrument_id,rental_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [original, stored, kind.mime, req.file.size, req.user.user_id,
       type === 'instrument' ? id : null, type === 'rental' ? id : null]);
  } catch (e) { await removeFile(stored); throw e; }
  await writeLog(req, 'file.upload', { resource: type, resourceId: id, detail: `${original} (${kind.mime}, ${req.file.size} bytes)` });
  flash(req, 'ok', 'อัปโหลดไฟล์เรียบร้อย');
  res.redirect(back);
});

async function loadFile(id) {
  return (await pool.query(
    `SELECT f.*, r.user_id AS rental_owner FROM files f LEFT JOIN rentals r ON r.rental_id=f.rental_id
     WHERE f.file_id=$1`, [id])).rows[0];
}

// ไฟล์ทุกไฟล์เปิดผ่าน Route นี้เท่านั้น (ตรวจสิทธิ์ทุกครั้ง) ไม่มี URL สาธารณะ
router.get('/files/:id', requirePermission('file.read'), async (req, res, next) => {
  const f = await loadFile(req.params.id);
  if (!f) return res.status(404).render('error', { title: 'ไม่พบไฟล์', status: 404, message: 'ไม่พบไฟล์ที่ต้องการ' });
  if (f.rental_id && f.rental_owner !== req.user.user_id && !req.can('rental.read.all'))
    return forbidden(req, res, 'เจ้าของไฟล์/รายการเท่านั้น (หรือ rental.read.all)');
  const abs = filePath(f.stored_name);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=0');
  // ไฟล์อาจถูกลบระหว่างที่กำลังเปิด (Race): แจ้ง 404 ที่อ่านง่าย ไม่โชว์พาธของเซิร์ฟเวอร์
  const done = err => {
    if (!err || res.headersSent) return;
    if (err.code === 'ENOENT' || err.status === 404)
      return res.status(404).render('error', { title: 'ไม่พบไฟล์', status: 404, message: 'ไฟล์นี้ถูกลบไปแล้ว' });
    next(err);
  };
  if (req.query.download === '1') return res.download(abs, f.original_name, done);
  res.type(f.mime_type);
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(abs, done);
});

router.post('/files/:id/delete', requirePermission('file.delete'), async (req, res) => {
  const f = await loadFile(req.params.id);
  if (!f) bad('ไม่พบไฟล์');
  await pool.query('DELETE FROM files WHERE file_id=$1', [f.file_id]);
  await removeFile(f.stored_name);
  const type = f.instrument_id ? 'instrument' : 'rental';
  const target = f.instrument_id || f.rental_id;
  await writeLog(req, 'file.delete', { resource: type, resourceId: target, detail: f.original_name });
  flash(req, 'ok', 'ลบไฟล์แล้ว');
  res.redirect(`/app/${type === 'instrument' ? 'instruments' : 'rentals'}/${target}`);
});

/* ---------- Report (Permission report.view: เพิ่มผ่านหน้าเว็บตอนสาธิต) ---------- */
router.get('/reports', requirePermission('report.view'), async (req, res) => {
  res.render('reports', await getSummary());
});

module.exports = router;
