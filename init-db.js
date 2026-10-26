const fs = require('node:fs');
const path = require('node:path');
const pool = require('./db');
(async () => {
  try {
    if (process.argv.includes('--reset')) {
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      console.log('Schema reset (ไฟล์ในโฟลเดอร์ uploads ไม่ถูกลบ ให้ลบเองได้)');
    }
    await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    console.log('Tables created');
  } catch (err) { console.error(err.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
