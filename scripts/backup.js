// Backup data aplikasi (database + file siap cetak + font upload) ke satu folder bertanggal.
// Aman dijalankan saat aplikasi sedang berjalan.
//   node scripts/backup.js [folder-tujuan]
// Contoh cron harian (VPS):  0 2 * * *  cd /opt/requeststicker && node scripts/backup.js /opt/backup-sticker
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('../src/db');

const stamp = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace(/[:T]/g, '-');
const target = path.resolve(process.argv[2] || path.join(DATA_DIR, '..', 'backup'), `sticker-${stamp}`);
fs.mkdirSync(target, { recursive: true });

// consistent SQLite snapshot even while the server is writing
db.exec(`VACUUM INTO '${path.join(target, 'app.db').replace(/'/g, "''")}'`);

for (const dir of ['generated', 'fonts']) {
  const src = path.join(DATA_DIR, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(target, dir), { recursive: true });
}
console.log('Backup selesai:', target);
console.log('Restore: hentikan aplikasi, salin isi folder ini ke DATA_DIR (app.db, generated/, fonts/), lalu jalankan lagi.');
