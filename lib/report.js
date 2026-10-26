const pool = require('../db');
module.exports = async function getSummary() {
  const byStatus = (await pool.query(
    `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_price),0) AS amount
     FROM rentals GROUP BY status ORDER BY status`)).rows;
  const top = (await pool.query(
    `SELECT i.name, COUNT(*)::int AS times FROM rentals r JOIN instruments i USING (instrument_id)
     WHERE r.status NOT IN ('rejected','cancelled') GROUP BY i.name ORDER BY times DESC, i.name LIMIT 5`)).rows;
  const revenue = (await pool.query(
    `SELECT COALESCE(SUM(total_price),0) AS total FROM rentals WHERE status IN ('picked_up','returned')`)).rows[0].total;
  return { byStatus, top, revenue };
};
