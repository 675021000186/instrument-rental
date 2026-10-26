const pool = require('./db');
const bcrypt = require('bcryptjs');
const PERMS = require('./lib/permissions');
const DEMO = require('./lib/demo');

const ROLES = [
  ['admin', 'ผู้ดูแลระบบ: ใช้งานได้ทุกฟังก์ชัน จัดการผู้ใช้ Role สิทธิ์ และ Log', true],
  ['manager', 'ผู้จัดการร้าน: อนุมัติคำขอเช่า ดูรายการทั้งหมดและ Log', false],
  ['staff', 'เจ้าหน้าที่ร้าน: จัดการเครื่องดนตรี ส่งมอบและรับคืนเครื่อง', false],
  ['customer', 'ผู้เช่า: เลือกเครื่อง ส่งคำขอ ดูสถานะของตนเอง', false]
];
const GRANTS = {
  manager: ['instrument.read', 'instrument.create', 'instrument.update', 'instrument.delete',
    'rental.read.all', 'rental.approve', 'rental.update_status', 'file.upload', 'file.read', 'file.delete', 'log.read'],
  staff: ['instrument.read', 'instrument.create', 'instrument.update',
    'rental.read.all', 'rental.update_status', 'file.upload', 'file.read'],
  customer: ['instrument.read', 'rental.create', 'rental.read.own', 'rental.cancel.own', 'file.upload', 'file.read']
};
const INSTRUMENTS = [
  ['Yamaha F310 กีตาร์โปร่ง', 'guitar', 'กีตาร์โปร่งสำหรับมือใหม่ เสียงใส เล่นง่าย', 150, 3],
  ['Fender Stratocaster', 'guitar', 'กีตาร์ไฟฟ้าเสียงคลาสสิก พร้อมสายและแอมป์เล็ก', 300, 2],
  ['Casio CT-S300 คีย์บอร์ด', 'keyboard', 'คีย์บอร์ด 61 คีย์ พร้อมขาตั้งและอะแดปเตอร์', 200, 4],
  ['Roland FP-30X เปียโนไฟฟ้า', 'keyboard', 'เปียโนไฟฟ้า 88 คีย์ น้ำหนักคีย์เหมือนเปียโนจริง', 450, 1],
  ['Pearl Export ชุดกลอง', 'drums', 'ชุดกลอง 5 ชิ้น พร้อมฉาบและไม้กลอง', 600, 1],
  ['Cajon กล่องไม้', 'drums', 'กลองคาฮอง เหมาะกับงานอะคูสติก พกพาง่าย', 80, 4],
  ['ไวโอลิน 4/4', 'strings', 'ไวโอลินขนาดมาตรฐาน พร้อมคันชักและยางสน', 250, 2],
  ['ยูคูเลเล่ Concert', 'strings', 'ยูคูเลเล่ไซส์คอนเสิร์ต พร้อมกระเป๋า', 100, 5],
  ['Yamaha YFL-222 ฟลูต', 'wind', 'ฟลูตสำหรับนักเรียน พร้อมกล่องและผ้าเช็ด', 220, 2]
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query('SELECT COUNT(*)::int AS n FROM users');
    if (c.rows[0].n !== 0) throw new Error('ฐานข้อมูลไม่ว่าง (users มีข้อมูลแล้ว) ใช้ npm run reset หากต้องการเริ่มใหม่');

    for (const [name, desc, sys] of ROLES)
      await client.query('INSERT INTO roles (role_name,description,is_system) VALUES ($1,$2,$3)', [name, desc, sys]);
    for (const p of PERMS.filter(p => p.seed !== false))
      await client.query('INSERT INTO permissions (permission_name,description) VALUES ($1,$2)', [p.name, p.desc]);

    await client.query(`INSERT INTO role_permissions (role_id,permission_id)
      SELECT r.role_id,p.permission_id FROM roles r CROSS JOIN permissions p WHERE r.role_name='admin'`);
    for (const [role, names] of Object.entries(GRANTS))
      await client.query(`INSERT INTO role_permissions (role_id,permission_id)
        SELECT r.role_id,p.permission_id FROM roles r, permissions p
        WHERE r.role_name=$1 AND p.permission_name = ANY($2)`, [role, names]);

    for (const d of DEMO)
      await client.query(`INSERT INTO users (username,password_hash,full_name,role_id)
        SELECT $1,$2,$3,role_id FROM roles WHERE role_name=$4`,
        [d.username, await bcrypt.hash(d.password, 10), d.full_name, d.role]);

    for (const i of INSTRUMENTS)
      await client.query('INSERT INTO instruments (name,category,description,daily_price,stock) VALUES ($1,$2,$3,$4,$5)', i);

    // ตัวอย่างรายการเช่าครบทุกสถานะ (approved/picked_up ตัดสต็อกแล้ว)
    const rental = (user, inst, offset, days, status, reviewer) => client.query(
      `INSERT INTO rentals (user_id,instrument_id,start_date,days,total_price,status,reviewed_by)
       SELECT u.user_id,i.instrument_id,CURRENT_DATE + $3::int,$4::int,i.daily_price*$4::int,$5,
              (SELECT user_id FROM users WHERE username=$6)
       FROM users u, instruments i WHERE u.username=$1 AND i.name=$2`,
      [user, inst, offset, days, status, reviewer]);
    await rental('customer01', 'Casio CT-S300 คีย์บอร์ด', 3, 3, 'pending', null);
    await rental('customer01', 'Yamaha F310 กีตาร์โปร่ง', 1, 2, 'approved', 'manager01');
    await rental('customer01', 'ยูคูเลเล่ Concert', -20, 2, 'returned', 'manager01');
    await rental('customer02', 'Roland FP-30X เปียโนไฟฟ้า', 5, 4, 'pending', null);
    await rental('customer02', 'ไวโอลิน 4/4', -1, 5, 'picked_up', 'manager01');
    await client.query(`UPDATE instruments SET stock=stock-1 WHERE name IN ('Yamaha F310 กีตาร์โปร่ง','ไวโอลิน 4/4')`);

    await client.query(`INSERT INTO audit_logs (event,resource,result,detail)
      VALUES ('system.seed','database','success','สร้างข้อมูลเริ่มต้น')`);
    await client.query('COMMIT');
    console.log('Seed สำเร็จ — บัญชีทดสอบ:');
    for (const d of DEMO) console.log(`  ${d.role.padEnd(9)} ${d.username.padEnd(11)} / ${d.password}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
