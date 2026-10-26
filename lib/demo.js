// บัญชีทดสอบ: seed.js สร้างจากรายการนี้ และหน้า Login แสดงรายการเดียวกัน
module.exports = [
  { role: 'admin',    label: 'ผู้ดูแลระบบ',  username: 'admin',      password: 'Admin123!',    full_name: 'ผู้ดูแลระบบ',   note: 'ทำได้ทุกอย่าง จัดการผู้ใช้/Role/สิทธิ์/Log' },
  { role: 'manager',  label: 'ผู้จัดการร้าน', username: 'manager01',  password: 'Manager123!',  full_name: 'มานะ ผู้จัดการ', note: 'อนุมัติคำขอ ดูรายการทั้งหมดและ Log' },
  { role: 'staff',    label: 'เจ้าหน้าที่',   username: 'staff01',    password: 'Staff123!',    full_name: 'สมชาย เจ้าหน้าที่', note: 'จัดการเครื่องดนตรี ส่งมอบ/รับคืน' },
  { role: 'customer', label: 'ผู้เช่า 1',    username: 'customer01', password: 'Customer123!', full_name: 'กานดา ผู้เช่า',   note: 'ส่งคำขอเช่า ดูเฉพาะรายการของตนเอง' },
  { role: 'customer', label: 'ผู้เช่า 2',    username: 'customer02', password: 'Customer123!', full_name: 'ธนากร ผู้เช่า',   note: 'ใช้ทดสอบว่าดูรายการของคนอื่นไม่ได้' }
];
