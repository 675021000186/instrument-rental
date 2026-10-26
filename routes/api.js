const router = require('express').Router();
const pool = require('../db');
const { requireLogin, requirePermission, requireAny } = require('../middleware');
const { queryLogs } = require('../lib/log');
const getSummary = require('../lib/report');

router.use(requireLogin);

router.get('/instruments', requirePermission('instrument.read'), async (req, res) => {
  res.json((await pool.query('SELECT instrument_id,name,category,description,daily_price,stock FROM instruments ORDER BY instrument_id')).rows);
});
router.get('/rentals', requireAny('rental.read.all', 'rental.read.own'), async (req, res) => {
  const all = req.can('rental.read.all');
  res.json((await pool.query(
    `SELECT r.rental_id,r.user_id,i.name AS instrument,r.start_date,r.days,r.total_price,r.status
     FROM rentals r JOIN instruments i USING (instrument_id)
     WHERE ($1::boolean OR r.user_id=$2) ORDER BY r.rental_id DESC`, [all, req.user.user_id])).rows);
});
router.get('/reports/summary', requirePermission('report.view'), async (req, res) => res.json(await getSummary()));

// ---- API ของ Admin ----
router.get('/admin/users', requirePermission('user.manage'), async (req, res) => {
  res.json((await pool.query(
    `SELECT u.user_id,u.username,u.full_name,u.is_active,r.role_name
     FROM users u JOIN roles r USING (role_id) ORDER BY u.user_id`)).rows);
});
router.get('/admin/roles', requirePermission('role.manage'), async (req, res) => {
  res.json((await pool.query('SELECT role_id,role_name,description,is_system FROM roles ORDER BY role_id')).rows);
});
router.get('/admin/acl', requirePermission('acl.manage'), async (req, res) => {
  res.json((await pool.query(
    `SELECT r.role_name,p.permission_name FROM role_permissions rp
     JOIN roles r USING (role_id) JOIN permissions p USING (permission_id)
     ORDER BY r.role_name,p.permission_name`)).rows);
});
router.get('/admin/logs', requirePermission('log.read'), async (req, res) => {
  const q = req.query, s = k => String(q[k] || '').trim();
  res.json(await queryLogs({ from: s('from'), to: s('to'), username: s('username'), event: s('event'), result: s('result'), limit: s('limit') }));
});

module.exports = router;
