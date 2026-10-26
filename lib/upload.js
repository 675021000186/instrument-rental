const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 2);
const DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads'); // อยู่นอก public: เปิดผ่าน URL ตรงไม่ได้
fs.mkdirSync(DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });

// ตรวจชนิดไฟล์จาก "ไบต์แรกของไฟล์" (magic bytes) ไม่เชื่อนามสกุลหรือ Content-Type จาก Browser
const SIGS = [
  { mime: 'image/jpeg', ext: '.jpg', test: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { mime: 'image/png', ext: '.png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) },
  { mime: 'image/webp', ext: '.webp', test: b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { mime: 'application/pdf', ext: '.pdf', test: b => b.subarray(0, 5).toString() === '%PDF-' }
];
const detect = buf => (buf && buf.length > 12 && SIGS.find(s => s.test(buf))) || null;

async function saveBuffer(buf, ext) {
  const name = crypto.randomUUID() + ext; // ชื่อสุ่ม ไม่ชน ไม่ใช้ชื่อจากผู้ใช้
  await fs.promises.writeFile(path.join(DIR, name), buf, { flag: 'wx' });
  return name;
}
function filePath(stored) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(stored)) throw new Error('Unsafe file name');
  return path.join(DIR, stored);
}
async function removeFile(stored) {
  try { await fs.promises.unlink(filePath(stored)); } catch (e) { if (e.code !== 'ENOENT') console.error(e.message); }
}
function cleanName(name) {
  let n = String(name || 'file');
  const fixed = Buffer.from(n, 'latin1').toString('utf8'); // multer อ่านชื่อไฟล์เป็น latin1
  if (!fixed.includes('\ufffd')) n = fixed;
  return path.basename(n.replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 200) || 'file';
}
module.exports = { upload, detect, saveBuffer, filePath, removeFile, cleanName, MAX_MB };
