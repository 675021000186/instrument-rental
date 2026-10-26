const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireLogin, requirePermission, validId, bad, text, flash } = require('../middleware');
const { writeLog, queryLogs } = require('../lib/log');
const KNOWN = require('../lib/permissions');

const WIRED = new Set(KNOWN.map(p => p.name)); // Permission ที่มีโค้ดตรวจสอบจริง
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const ROLE_RE = /^[a-z0-9_]{2,30}$/;
const PERM_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

router.use(requireLogin);
router.param('id', (req, res, next, id) => {
  if (!validId(id)) return res.status(400).render('error', { title: 'ข้อมูลไม่ถูกต้อง', status: 400, message: 'รหัสไม่ถูกต้อง' });
  next();
});
const roleList = async () => (await pool.query('SELECT role_id,role_name FROM roles ORDER BY role_id')).rows;
const activeAdminsExcept = async (id, db = pool) => (await db.query(
  `SELECT COUNT(*)::int c FROM users u JOIN roles r USING (role_id)
   WHERE r.role_name='admin' AND u.is_active AND u.user_id<>$1`, [id])).rows[0].c;
// ล็อกระดับ Transaction: คำขอที่กระทบจำนวน Admin ต้องทำทีละคำขอ กัน Admin สองคนลดสิทธิ์กันพร้อมกันจนไม่เหลือ Admin
async function withAdminLock(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(7001)');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

/* ================= Users ================= */
function checkPassword(p) {
  if (p.length < 8 || Buffer.byteLength(p, 'utf8') > 72) bad('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร และไม่เกิน 72 ไบต์');
}
router.get('/users', requirePermission('user.manage'), async (req, res) => {
  const r = await pool.query(
    `SELECT u.user_id,u.username,u.full_name,u.is_active,u.created_at,r.role_name
     FROM users u JOIN roles r USING (role_id) ORDER BY u.user_id`);
  res.render('users-list', { rows: r.rows });
});
router.get('/users/new', requirePermission('user.manage'), async (req, res) => {
  res.render('users-form', { row: null, roles: await roleList() });
});
router.post('/users', requirePermission('user.manage'), async (req, res) => {
  const username = text(req.body.username), full = text(req.body.full_name), pw = String(req.body.password || '');
  if (!USERNAME_RE.test(username)) bad('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, _ ยาว 3–30 ตัวอักษร');
  if (!full || full.length > 100) bad('กรุณากรอกชื่อ-นามสกุล (ไม่เกิน 100 ตัวอักษร)');
  checkPassword(pw);
  if (!validId(req.body.role_id)) bad('กรุณาเลือก Role');
  const role = (await pool.query('SELECT role_name FROM roles WHERE role_id=$1', [req.body.role_id])).rows[0];
  if (!role) bad('ไม่พบ Role ที่เลือก');
  const r = await pool.query(
    'INSERT INTO users (username,password_hash,full_name,role_id) VALUES ($1,$2,$3,$4) RETURNING user_id',
    [username, await bcrypt.hash(pw, 10), full, req.body.role_id]);
  await writeLog(req, 'user.create', { resource: 'user', resourceId: r.rows[0].user_id, detail: `${username} role=${role.role_name}` });
  flash(req, 'ok', 'เพิ่มผู้ใช้เรียบร้อย');
  res.redirect('/admin/users');
});
router.get('/users/:id/edit', requirePermission('user.manage'), async (req, res) => {
  const r = await pool.query('SELECT user_id,username,full_name,role_id,is_active FROM users WHERE user_id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).render('error', { title: 'ไม่พบข้อมูล', status: 404, message: 'ไม่พบผู้ใช้' });
  res.render('users-form', { row: r.rows[0], roles: await roleList() });
});
router.post('/users/:id/update', requirePermission('user.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const full = text(req.body.full_name), pw = String(req.body.password || '');
  const active = req.body.is_active === 'on';
  if (!full || full.length > 100) bad('กรุณากรอกชื่อ-นามสกุล (ไม่เกิน 100 ตัวอักษร)');
  if (!validId(req.body.role_id)) bad('กรุณาเลือก Role');
  if (id === req.user.user_id && !active) bad('ไม่สามารถปิดการใช้งานบัญชีของตัวเองได้');
  if (pw) checkPassword(pw);
  const hash = pw ? await bcrypt.hash(pw, 10) : null; // แฮชนอกล็อก (ใช้เวลานาน)
  const { t, nr } = await withAdminLock(async c => {
    const t = (await c.query('SELECT u.*, r.role_name FROM users u JOIN roles r USING (role_id) WHERE u.user_id=$1', [id])).rows[0];
    if (!t) bad('ไม่พบผู้ใช้');
    const nr = (await c.query('SELECT role_name FROM roles WHERE role_id=$1', [req.body.role_id])).rows[0];
    if (!nr) bad('ไม่พบ Role ที่เลือก');
    if (t.role_name === 'admin' && (nr.role_name !== 'admin' || !active) && (await activeAdminsExcept(id, c)) < 1)
      bad('ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คนเสมอ');
    await c.query('UPDATE users SET full_name=$1,role_id=$2,is_active=$3,password_hash=COALESCE($4,password_hash) WHERE user_id=$5',
      [full, req.body.role_id, active, hash, id]);
    return { t, nr };
  });
  if (t.role_name !== nr.role_name)
    await writeLog(req, 'user.role_change', { resource: 'user', resourceId: id, detail: `${t.username}: ${t.role_name} → ${nr.role_name}` });
  await writeLog(req, 'user.update', { resource: 'user', resourceId: id,
    detail: `${t.username}${pw ? ' (เปลี่ยนรหัสผ่าน)' : ''}${t.is_active !== active ? (active ? ' (เปิดใช้งาน)' : ' (ปิดใช้งาน)') : ''}` });
  flash(req, 'ok', 'บันทึกข้อมูลผู้ใช้แล้ว (Role ใหม่มีผลทันที)');
  res.redirect('/admin/users');
});
router.post('/users/:id/delete', requirePermission('user.manage'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.user_id) bad('ไม่สามารถลบบัญชีของตัวเองได้');
  const t = await withAdminLock(async c => {
    const t = (await c.query('SELECT u.username, r.role_name FROM users u JOIN roles r USING (role_id) WHERE u.user_id=$1', [id])).rows[0];
    if (!t) bad('ไม่พบผู้ใช้');
    if (t.role_name === 'admin' && (await activeAdminsExcept(id, c)) < 1) bad('ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คนเสมอ');
    await c.query('DELETE FROM users WHERE user_id=$1', [id]); // มีประวัติเช่า/ไฟล์ => FK ปฏิเสธ ให้ปิดการใช้งานแทน
    return t;
  });
  await writeLog(req, 'user.delete', { resource: 'user', resourceId: id, detail: t.username });
  flash(req, 'ok', 'ลบผู้ใช้แล้ว');
  res.redirect('/admin/users');
});

/* ================= Roles ================= */
router.get('/roles', requirePermission('role.manage'), async (req, res) => {
  const r = await pool.query(
    `SELECT r.*, (SELECT COUNT(*)::int FROM users u WHERE u.role_id=r.role_id) AS user_count,
            (SELECT COUNT(*)::int FROM role_permissions rp WHERE rp.role_id=r.role_id) AS perm_count
     FROM roles r ORDER BY r.role_id`);
  res.render('roles', { rows: r.rows });
});
router.post('/roles', requirePermission('role.manage'), async (req, res) => {
  const name = text(req.body.role_name).toLowerCase(), desc = text(req.body.description);
  if (!ROLE_RE.test(name)) bad('ชื่อ Role ใช้ a-z, 0-9, _ ยาว 2–30 ตัวอักษร');
  if (desc.length > 255) bad('คำอธิบายยาวเกิน 255 ตัวอักษร');
  const r = await pool.query('INSERT INTO roles (role_name,description) VALUES ($1,$2) RETURNING role_id', [name, desc]);
  await writeLog(req, 'role.create', { resource: 'role', resourceId: r.rows[0].role_id, detail: name });
  flash(req, 'ok', `เพิ่ม Role "${name}" แล้ว — ไปที่หน้า ACL เพื่อกำหนดสิทธิ์`);
  res.redirect('/admin/roles');
});
router.post('/roles/:id/update', requirePermission('role.manage'), async (req, res) => {
  const t = (await pool.query('SELECT * FROM roles WHERE role_id=$1', [req.params.id])).rows[0];
  if (!t) bad('ไม่พบ Role');
  const name = t.is_system ? t.role_name : text(req.body.role_name).toLowerCase(); // Role admin ห้ามเปลี่ยนชื่อ
  const desc = text(req.body.description);
  if (!ROLE_RE.test(name)) bad('ชื่อ Role ใช้ a-z, 0-9, _ ยาว 2–30 ตัวอักษร');
  if (desc.length > 255) bad('คำอธิบายยาวเกิน 255 ตัวอักษร');
  await pool.query('UPDATE roles SET role_name=$1,description=$2 WHERE role_id=$3', [name, desc, t.role_id]);
  await writeLog(req, 'role.update', { resource: 'role', resourceId: t.role_id, detail: `${t.role_name} → ${name}` });
  flash(req, 'ok', 'บันทึก Role แล้ว');
  res.redirect('/admin/roles');
});
router.post('/roles/:id/delete', requirePermission('role.manage'), async (req, res) => {
  const t = (await pool.query(
    `SELECT r.*, (SELECT COUNT(*)::int FROM users u WHERE u.role_id=r.role_id) AS user_count
     FROM roles r WHERE r.role_id=$1`, [req.params.id])).rows[0];
  if (!t) bad('ไม่พบ Role');
  if (t.is_system) bad('ไม่สามารถลบ Role ระบบ (admin) ได้');
  if (t.user_count > 0) bad(`ลบไม่ได้: ยังมีผู้ใช้ ${t.user_count} คนใน Role นี้ (ย้ายผู้ใช้ไป Role อื่นก่อน)`);
  await pool.query('DELETE FROM roles WHERE role_id=$1', [t.role_id]);
  await writeLog(req, 'role.delete', { resource: 'role', resourceId: t.role_id, detail: t.role_name });
  flash(req, 'ok', 'ลบ Role แล้ว');
  res.redirect('/admin/roles');
});

/* ================= Permissions ================= */
router.get('/permissions', requirePermission('permission.manage'), async (req, res) => {
  const r = await pool.query(
    `SELECT p.*, (SELECT COUNT(*)::int FROM role_permissions rp WHERE rp.permission_id=p.permission_id) AS role_count
     FROM permissions p ORDER BY p.permission_name`);
  res.render('permissions', { rows: r.rows, wired: WIRED });
});
router.post('/permissions', requirePermission('permission.manage'), async (req, res) => {
  const name = text(req.body.permission_name).toLowerCase(), desc = text(req.body.description);
  if (!PERM_RE.test(name) || name.length > 80) bad('ชื่อ Permission ต้องเป็นรูปแบบ resource.action เช่น equipment.read');
  if (desc.length > 255) bad('คำอธิบายยาวเกิน 255 ตัวอักษร');
  const r = await pool.query('INSERT INTO permissions (permission_name,description) VALUES ($1,$2) RETURNING permission_id', [name, desc]);
  await pool.query(`INSERT INTO role_permissions (role_id,permission_id)
                    SELECT role_id,$1 FROM roles WHERE role_name='admin'`, [r.rows[0].permission_id]);
  const wired = WIRED.has(name);
  await writeLog(req, 'permission.create', { resource: 'permission', resourceId: r.rows[0].permission_id,
    detail: `${name} (${wired ? 'เชื่อมกับฟังก์ชันในระบบแล้ว' : 'ยังไม่มีโค้ดใช้งาน'})` });
  flash(req, wired ? 'ok' : 'warn', wired
    ? `เพิ่ม "${name}" แล้ว — ไปหน้า ACL เพื่อกำหนดให้ Role`
    : `เพิ่ม "${name}" แล้ว แต่ยังไม่มีฟังก์ชันที่ตรวจสิทธิ์นี้ (เป็นเพียงนิยาม)`);
  res.redirect('/admin/permissions');
});
router.post('/permissions/:id/update', requirePermission('permission.manage'), async (req, res) => {
  const t = (await pool.query('SELECT * FROM permissions WHERE permission_id=$1', [req.params.id])).rows[0];
  if (!t) bad('ไม่พบ Permission');
  const desc = text(req.body.description);
  const name = WIRED.has(t.permission_name) ? t.permission_name : text(req.body.permission_name).toLowerCase();
  if (!PERM_RE.test(name) || name.length > 80) bad('ชื่อ Permission ต้องเป็นรูปแบบ resource.action เช่น equipment.read');
  if (desc.length > 255) bad('คำอธิบายยาวเกิน 255 ตัวอักษร');
  await pool.query('UPDATE permissions SET permission_name=$1,description=$2 WHERE permission_id=$3', [name, desc, t.permission_id]);
  await writeLog(req, 'permission.update', { resource: 'permission', resourceId: t.permission_id, detail: `${t.permission_name} → ${name}` });
  flash(req, 'ok', 'บันทึก Permission แล้ว');
  res.redirect('/admin/permissions');
});
router.post('/permissions/:id/delete', requirePermission('permission.manage'), async (req, res) => {
  const r = await pool.query('DELETE FROM permissions WHERE permission_id=$1 RETURNING permission_name', [req.params.id]); // ลบการกำหนดสิทธิ์ใน ACL ด้วย (CASCADE)
  if (!r.rowCount) bad('ไม่พบ Permission');
  await writeLog(req, 'permission.delete', { resource: 'permission', resourceId: req.params.id, detail: r.rows[0].permission_name });
  flash(req, 'ok', 'ลบ Permission แล้ว (การกำหนดสิทธิ์ที่เกี่ยวข้องถูกลบด้วย)');
  res.redirect('/admin/permissions');
});

/* ================= ACL (Role × Permission) ================= */
router.get('/acl', requirePermission('acl.manage'), async (req, res) => {
  const roles = (await pool.query(
    `SELECT r.role_id,r.role_name,(SELECT COUNT(*)::int FROM users u WHERE u.role_id=r.role_id) AS user_count
     FROM roles r ORDER BY r.role_id`)).rows;
  const perms = (await pool.query('SELECT * FROM permissions ORDER BY permission_name')).rows;
  const grants = new Set((await pool.query('SELECT role_id,permission_id FROM role_permissions')).rows.map(x => x.role_id + '_' + x.permission_id));
  res.render('acl', { roles, perms, grants, wired: WIRED });
});
router.post('/acl/save', requirePermission('acl.manage'), async (req, res) => {
  const roles = (await pool.query("SELECT role_id,role_name FROM roles WHERE role_name<>'admin'")).rows; // admin ล็อกไว้ ได้ทุกสิทธิ์
  const perms = (await pool.query('SELECT permission_id,permission_name FROM permissions')).rows;
  const have = new Set((await pool.query('SELECT role_id,permission_id FROM role_permissions')).rows.map(x => x.role_id + '_' + x.permission_id));
  const changes = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of roles) for (const p of perms) {
      const key = r.role_id + '_' + p.permission_id;
      const want = req.body['g_' + key] === 'on';
      if (want && !have.has(key)) {
        await client.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.role_id, p.permission_id]);
        changes.push(['acl.grant', r, p]);
      } else if (!want && have.has(key)) {
        await client.query('DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2', [r.role_id, p.permission_id]);
        changes.push(['acl.revoke', r, p]);
      }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  for (const [ev, r, p] of changes)
    await writeLog(req, ev, { resource: 'acl', resourceId: r.role_id, detail: `role=${r.role_name} permission=${p.permission_name}` });
  const g = changes.filter(c => c[0] === 'acl.grant').length;
  flash(req, 'ok', changes.length ? `บันทึกสิทธิ์แล้ว (เพิ่ม ${g}, ยกเลิก ${changes.length - g}) — มีผลทันที` : 'ไม่มีการเปลี่ยนแปลง');
  res.redirect('/admin/acl');
});

/* ================= Logs ================= */
router.get('/logs', requirePermission('log.read'), async (req, res) => {
  const q = req.query;
  const f = { from: text(q.from), to: text(q.to), username: text(q.username).slice(0, 50), event: text(q.event), result: text(q.result) };
  const rows = await queryLogs(f);
  const events = (await pool.query('SELECT DISTINCT event FROM audit_logs ORDER BY event')).rows.map(x => x.event);
  res.render('logs', { rows, f, events });
});

module.exports = router;
