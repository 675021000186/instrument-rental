const pool = require('../db');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// บันทึก Log ลง PostgreSQL (ห้ามส่งรหัสผ่าน/Session/Token เข้ามาใน detail)
async function writeLog(req, event, o = {}) {
  try {
    const u = req && req.user;
    await pool.query(
      `INSERT INTO audit_logs (user_id,username,event,resource,resource_id,result,detail,ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [o.userId ?? (u ? u.user_id : null), o.username ?? (u ? u.username : null), event,
       o.resource ?? null, o.resourceId == null ? null : String(o.resourceId),
       o.result || 'success', String(o.detail || '').slice(0, 500), req ? req.ip : null]);
  } catch (e) { console.error('writeLog failed:', e.message); }
}

async function queryLogs(f) {
  const where = [], p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', '$' + p.length)); };
  if (DATE.test(f.from || '')) add("l.created_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Bangkok'", f.from);
  if (DATE.test(f.to || '')) add("l.created_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')", f.to);
  if (f.username) add("l.username ILIKE '%' || ? || '%'", f.username);
  if (f.event) add('l.event = ?', f.event);
  if (f.result) add('l.result = ?', f.result);
  const limit = Math.min(Math.max(parseInt(f.limit) || 300, 1), 500);
  const r = await pool.query(
    `SELECT l.* FROM audit_logs l ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY l.log_id DESC LIMIT ${limit}`, p);
  return r.rows;
}
module.exports = { writeLog, queryLogs };
