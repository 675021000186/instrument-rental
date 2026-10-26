// รายการ Permission ที่ "โค้ดตรวจสอบจริง" (เชื่อมกับ Route แล้ว)
// seed:false = ยังไม่ใส่ในฐานข้อมูล ให้ Admin เพิ่มผ่านหน้าเว็บตอนสาธิต
module.exports = [
  { name: 'instrument.read',   desc: 'ดูรายการและรายละเอียดเครื่องดนตรี' },
  { name: 'instrument.create', desc: 'เพิ่มเครื่องดนตรีใหม่' },
  { name: 'instrument.update', desc: 'แก้ไขข้อมูลเครื่องดนตรี' },
  { name: 'instrument.delete', desc: 'ลบเครื่องดนตรี' },
  { name: 'rental.create',     desc: 'ส่งคำขอเช่าเครื่องดนตรี' },
  { name: 'rental.read.own',   desc: 'ดูรายการเช่าของตนเอง' },
  { name: 'rental.read.all',   desc: 'ดูรายการเช่าของทุกคน' },
  { name: 'rental.cancel.own', desc: 'ยกเลิกคำขอของตนเอง (ที่ยังรออนุมัติ)' },
  { name: 'rental.approve',    desc: 'อนุมัติหรือปฏิเสธคำขอเช่า' },
  { name: 'rental.update_status', desc: 'ส่งมอบ รับคืน หรือยกเลิกรายการเช่า' },
  { name: 'file.upload',       desc: 'อัปโหลดไฟล์/รูปภาพ' },
  { name: 'file.read',         desc: 'เปิดดูหรือดาวน์โหลดไฟล์' },
  { name: 'file.delete',       desc: 'ลบไฟล์' },
  { name: 'user.manage',       desc: 'จัดการผู้ใช้' },
  { name: 'role.manage',       desc: 'จัดการ Role' },
  { name: 'permission.manage', desc: 'จัดการรายการ Permission' },
  { name: 'acl.manage',        desc: 'กำหนด Permission ให้ Role (ACL)' },
  { name: 'log.read',          desc: 'ดู Log การใช้งาน' },
  { name: 'report.view',       desc: 'ดูรายงานสรุปการเช่า', seed: false }
];
