const TZ = 'Asia/Bangkok';
const STATUS = {
  pending: ['รออนุมัติ', 'warn'], approved: ['อนุมัติแล้ว', 'info'],
  rejected: ['ปฏิเสธ', 'bad'], picked_up: ['กำลังเช่า', 'primary'],
  returned: ['คืนแล้ว', 'ok'], cancelled: ['ยกเลิก', 'muted']
};
const CATEGORY = {
  guitar: ['กีตาร์/เบส', '🎸'], keyboard: ['คีย์บอร์ด/เปียโน', '🎹'],
  drums: ['กลอง/เครื่องเคาะ', '🥁'], strings: ['เครื่องสาย', '🎻'],
  wind: ['เครื่องเป่า', '🎺'], other: ['อื่น ๆ', '🎼']
};
const isCategory = k => Object.hasOwn(CATEGORY, k);
const addDays = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
const todayStr = () => addDays(0);
const isDate = s => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
};

//  ปรับปรุงโดยเพิ่ม calendar: 'gregory' เพื่อบังคับแสดงปี ค.ศ.
const fmtDateTime = d => d ? new Date(d).toLocaleString('th-TH', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'medium', calendar: 'gregory' }) : '-';
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { dateStyle: 'medium', calendar: 'gregory' }) : '-';

const baht = n => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' ฿';
const kb = n => (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';

module.exports = { STATUS, CATEGORY, isCategory, addDays, todayStr, isDate, fmtDateTime, fmtDate, baht, kb };
