const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const { db, hashPassword, verifyPassword, getSetting, setSetting, tx, DATA_DIR } = require('./src/db');
const { syncFromDrive, seedIfEmpty, driveFileLink, driveFolderLink, isSyncing, DEFAULT_ROOT } = require('./src/catalogSync');
const { getThumbnail } = require('./src/thumbs');
const { requestPdf, recapPdf, APPROVER_ROLES, STATUS_LABEL } = require('./src/reportPdf');
const { detect, replaceBatchExp, fontInfo } = require('./src/batchReplace');
const { parseDimension, parseVolume, classifyPackaging, PACKAGING_TYPES } = require('./src/catalogParser');
const { purchasePdf } = require('./src/purchasePdf');

const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 14;
const SUPPLIERS = ['Kame', 'PWD', 'Jawara Pouch', 'Flexypack Sachet & Pouch', 'Juke Sachet & Pouch', 'Lainnya'];
const ROLES = ['admin', 'user', 'manager_desain', 'purchasing', 'desainer'];
const GEN_DIR = path.join(DATA_DIR, 'generated');
const SRC_DIR = path.join(DATA_DIR, 'sources');
const FONT_DIR = process.env.FONT_DIR || path.join(__dirname, 'fonts');
fs.mkdirSync(GEN_DIR, { recursive: true });
fs.mkdirSync(SRC_DIR, { recursive: true });

// ---------- bootstrap ----------
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  const pw = process.env.DEFAULT_PASSWORD || 'ganti123';
  const ins = db.prepare('INSERT INTO users(username,name,password_hash,role,division) VALUES(?,?,?,?,?)');
  ins.run('admin', 'Administrator', hashPassword(process.env.ADMIN_PASSWORD || 'admin123'), 'admin', 'Desain');
  ins.run('desainer', 'Desainer', hashPassword(pw), 'desainer', 'Desain');
  ins.run('manager', 'Manager Desain', hashPassword(pw), 'manager_desain', 'Desain');
  ins.run('purchasing', 'Purchasing', hashPassword(pw), 'purchasing', 'Purchasing');
  ins.run('user', 'Tim Produksi', hashPassword(pw), 'user', 'Produksi');
  console.log('Akun awal dibuat: admin/admin123 dan desainer, manager, purchasing, user (password: ' + pw + ')');
}
const seeded = seedIfEmpty();
if (seeded) console.log('Katalog awal dimuat dari seed:', seeded);
// One-time: classify packaging type for catalogs imported before this feature existed.
if (!getSetting('pkg_classified')) {
  tx(() => {
    const rows = db.prepare(`SELECT v.id, v.file_name, v.name, p.name AS product_name FROM variants v JOIN products p ON p.id = v.product_id
                             WHERE v.package_type_manual = 0`).all();
    const upd = db.prepare('UPDATE variants SET package_type = ? WHERE id = ?');
    for (const r of rows) upd.run(classifyPackaging(r.file_name || r.name, [], r.product_name), r.id);
  });
  setSetting('pkg_classified', '1');
}
// Request items created before packaging types existed: copy the type from the catalog.
db.exec(`UPDATE request_items SET package_type = (SELECT v.package_type FROM variants v WHERE v.id = request_items.variant_id)
         WHERE (package_type IS NULL OR package_type = '') AND variant_id IS NOT NULL`);

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '5mb' }));

// ---------- helpers ----------
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => new HttpError(400, msg);
const baseUrl = req => (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const str = (v, max = 500) => (v == null ? '' : String(v)).trim().slice(0, max);
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // WIB

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function publicUser(u) {
  return u && { id: u.id, username: u.username, name: u.name, role: u.role, division: u.division, has_signature: !!u.signature, active: !!u.active };
}
function extractDriveId(link) {
  const s = str(link, 1000);
  const m = s.match(/\/(?:file\/d|folders|document\/d|spreadsheets\/d|presentation\/d)\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}

// Render a PDF fully in memory first, so a rendering error becomes a clear JSON error instead of a broken file.
async function sendPdf(res, render) {
  const out = new PassThrough();
  const chunks = [];
  out.on('data', c => chunks.push(c));
  const finished = new Promise((ok, fail) => { out.on('end', ok); out.on('error', fail); });
  await render(out);
  await finished;
  res.send(Buffer.concat(chunks));
}

// ---------- auth ----------
app.use((req, res, next) => {
  const token = parseCookies(req).sid;
  if (token) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                            WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`).get(token, Date.now());
    if (row) req.user = row;
  }
  next();
});
const auth = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Anda tidak memiliki akses.' });
  next();
};

app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(str(req.body.username, 100));
  if (!u || !verifyPassword(String(req.body.password || ''), u.password_hash)) return res.status(401).json({ error: 'Username atau password salah.' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, u.id, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  res.json({ user: publicUser(u) });
});
app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) || null, suppliers: SUPPLIERS }));
app.get('/api/me/signature', auth(), (req, res) => res.json({ signature: req.user.signature || null }));
app.put('/api/me/signature', auth(), (req, res) => {
  const sig = String(req.body.signature || '');
  if (sig && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig)) throw bad('Format tanda tangan tidak valid.');
  db.prepare('UPDATE users SET signature = ? WHERE id = ?').run(sig || null, req.user.id);
  res.json({ ok: true });
});
app.put('/api/me/password', auth(), (req, res) => {
  const { old_password, new_password } = req.body;
  if (!verifyPassword(String(old_password || ''), req.user.password_hash)) throw bad('Password lama salah.');
  if (String(new_password || '').length < 6) throw bad('Password baru minimal 6 karakter.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(new_password)), req.user.id);
  res.json({ ok: true });
});

// ---------- users (admin) ----------
app.get('/api/users', auth('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY role, name').all().map(publicUser));
});
app.post('/api/users', auth('admin'), (req, res) => {
  const username = str(req.body.username, 50), name = str(req.body.name, 100), role = str(req.body.role, 30);
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) throw bad('Username 3-50 karakter (huruf, angka, titik, strip).');
  if (!name) throw bad('Nama wajib diisi.');
  if (!ROLES.includes(role)) throw bad('Role tidak valid.');
  if (String(req.body.password || '').length < 6) throw bad('Password minimal 6 karakter.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('Username sudah dipakai.');
  const r = db.prepare('INSERT INTO users(username,name,password_hash,role,division) VALUES(?,?,?,?,?)')
    .run(username, name, hashPassword(String(req.body.password)), role, str(req.body.division, 100));
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/users/:id', auth('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'User tidak ditemukan.');
  const role = req.body.role !== undefined ? str(req.body.role, 30) : u.role;
  if (!ROLES.includes(role)) throw bad('Role tidak valid.');
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : u.active;
  if (u.id === req.user.id && (role !== 'admin' || !active)) throw bad('Tidak bisa menonaktifkan / mengubah role akun sendiri.');
  db.prepare('UPDATE users SET name=?, role=?, division=?, active=? WHERE id=?')
    .run(str(req.body.name ?? u.name, 100) || u.name, role, str(req.body.division ?? u.division, 100), active, u.id);
  if (req.body.password) {
    if (String(req.body.password).length < 6) throw bad('Password minimal 6 karakter.');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(String(req.body.password)), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.json({ ok: true });
});

// ---------- catalog ----------
app.get('/api/brands', auth(), (req, res) => {
  res.json(db.prepare(`SELECT b.id, b.name, b.drive_folder_id,
      (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id AND p.active = 1
         AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1)) AS product_count
    FROM brands b WHERE b.active = 1 ORDER BY b.name`).all());
});

function productRow(p) {
  return { ...p, drive_link: p.drive_link || (p.drive_key?.startsWith('folder:') ? driveFolderLink(p.drive_key.slice(7)) : '') };
}
function variantRow(v) {
  return { ...v, tags: JSON.parse(v.tags || '[]'), alt_files: JSON.parse(v.alt_files || '[]') };
}

app.get('/api/products', auth(), (req, res) => {
  const where = ['p.active = 1', 'b.active = 1'];
  const args = [];
  if (req.query.brand_id) { where.push('p.brand_id = ?'); args.push(Number(req.query.brand_id)); }
  if (PACKAGING_TYPES.includes(req.query.package_type)) {
    where.push('EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.package_type = ?)');
    args.push(req.query.package_type);
  }
  if (!req.query.include_empty) where.push('EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1)');
  const q = str(req.query.q, 100);
  if (q) {
    for (const word of q.split(/\s+/).filter(Boolean).slice(0, 6)) {
      where.push(`(p.name LIKE ? OR p.code LIKE ? OR p.description LIKE ? OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND (v.name LIKE ? OR v.file_name LIKE ?)))`);
      const like = `%${word}%`;
      args.push(like, like, like, like, like);
    }
  }
  const limit = Math.min(Number(req.query.limit) || 60, 500);
  const rows = db.prepare(`SELECT p.*, b.name AS brand_name,
      (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS variant_count,
      (SELECT v.drive_file_id FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.drive_file_id IS NOT NULL ORDER BY v.id LIMIT 1) AS thumb_file_id,
      (SELECT group_concat(d, ' | ') FROM (SELECT DISTINCT v.dimension AS d FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.dimension <> '')) AS dimensions,
      (SELECT group_concat(t) FROM (SELECT DISTINCT v.package_type AS t FROM variants v WHERE v.product_id = p.id AND v.active = 1)) AS package_types
    FROM products p JOIN brands b ON b.id = p.brand_id
    WHERE ${where.join(' AND ')}
    ORDER BY b.name, CASE WHEN p.code = '' THEN 1 ELSE 0 END, length(p.code), p.code, p.name LIMIT ?`).all(...args, limit);
  res.json(rows.map(productRow));
});

app.get('/api/products/:id', auth(), (req, res) => {
  const p = db.prepare(`SELECT p.*, b.name AS brand_name FROM products p JOIN brands b ON b.id = p.brand_id WHERE p.id = ?`).get(req.params.id);
  if (!p) throw new HttpError(404, 'Produk tidak ditemukan.');
  const variants = db.prepare('SELECT * FROM variants WHERE product_id = ? AND active = 1 ORDER BY name').all(p.id).map(variantRow);
  res.json({ ...productRow(p), variants });
});

// Admin catalog management
app.post('/api/brands', auth('admin'), (req, res) => {
  const name = str(req.body.name, 100);
  if (!name) throw bad('Nama brand wajib diisi.');
  const ex = db.prepare('SELECT * FROM brands WHERE name = ?').get(name);
  if (ex) { db.prepare('UPDATE brands SET active = 1 WHERE id = ?').run(ex.id); return res.json({ id: ex.id }); }
  const r = db.prepare('INSERT INTO brands(name, drive_folder_id) VALUES(?, ?)').run(name, extractDriveId(req.body.drive_link) || null);
  res.json({ id: Number(r.lastInsertRowid) });
});

function variantInput(body) {
  const link = str(body.drive_link, 1000);
  const fileId = extractDriveId(link);
  const name = str(body.name, 300);
  const fileName = str(body.file_name, 300);
  return {
    name: name || fileName || 'Standar',
    dimension: str(body.dimension, 50) || parseDimension(name + ' ' + fileName),
    volume: str(body.volume, 50) || parseVolume(name + ' ' + fileName),
    tags: JSON.stringify(Array.isArray(body.tags) ? body.tags.map(t => str(t, 30)).filter(Boolean) : []),
    drive_file_id: fileId || null,
    drive_link: fileId ? driveFileLink(fileId) : link,
    file_name: fileName,
    file_type: str(body.file_type, 10) || 'pdf',
    package_type: PACKAGING_TYPES.includes(body.package_type) ? body.package_type : classifyPackaging(fileName || name, [], ''),
    package_type_manual: PACKAGING_TYPES.includes(body.package_type) ? 1 : 0,
  };
}

app.post('/api/products', auth('admin'), (req, res) => {
  const brandId = Number(req.body.brand_id);
  if (!db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brandId)) throw bad('Pilih brand.');
  const name = str(req.body.name, 300);
  if (!name) throw bad('Nama produk wajib diisi.');
  const variants = Array.isArray(req.body.variants) ? req.body.variants : [];
  if (!variants.length) throw bad('Tambahkan minimal 1 file sticker (variasi) beserta link Google Drive-nya.');
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO products(brand_id, code, name, description, volume, drive_link, source) VALUES(?,?,?,?,?,?,'manual')`)
      .run(brandId, str(req.body.code, 20).toUpperCase(), name, str(req.body.description, 2000), str(req.body.volume, 50), str(req.body.drive_link, 1000));
    const pid = Number(r.lastInsertRowid);
    for (const v of variants) insertVariant(pid, v);
    return pid;
  });
  res.json({ id });
});

function insertVariant(pid, body) {
  const v = variantInput(body);
  if (!v.drive_file_id) throw bad(`Link Google Drive file untuk variasi "${v.name}" tidak valid. Gunakan link file (bukan folder).`);
  const ex = db.prepare('SELECT id, product_id FROM variants WHERE drive_file_id = ?').get(v.drive_file_id);
  if (ex) {
    db.prepare(`UPDATE variants SET product_id=?, name=?, dimension=?, volume=?, tags=?, drive_link=?, file_name=?, file_type=?,
      package_type=?, package_type_manual=?, active=1 WHERE id=?`)
      .run(pid, v.name, v.dimension, v.volume, v.tags, v.drive_link, v.file_name, v.file_type, v.package_type, v.package_type_manual, ex.id);
    return ex.id;
  }
  return Number(db.prepare(`INSERT INTO variants(product_id, name, dimension, volume, tags, drive_file_id, drive_link, file_name, file_type,
    package_type, package_type_manual, source) VALUES(?,?,?,?,?,?,?,?,?,?,?,'manual')`)
    .run(pid, v.name, v.dimension, v.volume, v.tags, v.drive_file_id, v.drive_link, v.file_name, v.file_type, v.package_type, v.package_type_manual).lastInsertRowid);
}

app.put('/api/products/:id', auth('admin'), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) throw new HttpError(404, 'Produk tidak ditemukan.');
  const b = req.body;
  db.prepare(`UPDATE products SET brand_id=?, code=?, name=?, description=?, volume=?, drive_link=?, active=?, updated_at=datetime('now') WHERE id=?`).run(
    b.brand_id ? Number(b.brand_id) : p.brand_id, b.code !== undefined ? str(b.code, 20).toUpperCase() : p.code,
    str(b.name ?? p.name, 300) || p.name, b.description !== undefined ? str(b.description, 2000) : p.description,
    b.volume !== undefined ? str(b.volume, 50) : p.volume, b.drive_link !== undefined ? str(b.drive_link, 1000) : p.drive_link,
    b.active !== undefined ? (b.active ? 1 : 0) : p.active, p.id);
  res.json({ ok: true });
});
app.delete('/api/products/:id', auth('admin'), (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/products/:id/variants', auth('admin'), (req, res) => {
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(req.params.id)) throw new HttpError(404, 'Produk tidak ditemukan.');
  res.json({ id: insertVariant(Number(req.params.id), req.body) });
});
app.put('/api/variants/:id', auth('admin'), (req, res) => {
  const v = db.prepare('SELECT * FROM variants WHERE id = ?').get(req.params.id);
  if (!v) throw new HttpError(404, 'Variasi tidak ditemukan.');
  const b = req.body;
  const pkgChanged = PACKAGING_TYPES.includes(b.package_type) && b.package_type !== v.package_type;
  db.prepare('UPDATE variants SET name=?, dimension=?, volume=?, active=?, package_type=?, package_type_manual=? WHERE id=?').run(
    str(b.name ?? v.name, 300) || v.name, b.dimension !== undefined ? str(b.dimension, 50) : v.dimension,
    b.volume !== undefined ? str(b.volume, 50) : v.volume, b.active !== undefined ? (b.active ? 1 : 0) : v.active,
    pkgChanged ? b.package_type : v.package_type, pkgChanged ? 1 : v.package_type_manual, v.id);
  res.json({ ok: true });
});
app.delete('/api/variants/:id', auth('admin'), (req, res) => {
  db.prepare('UPDATE variants SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/sync', auth(), (req, res) => {
  res.json({
    running: isSyncing(), last_sync: getSetting('last_sync'), stats: JSON.parse(getSetting('last_sync_stats', 'null')),
    root_id: getSetting('drive_root_id', DEFAULT_ROOT), last_error: getSetting('last_sync_error', ''),
  });
});
app.post('/api/sync', auth('admin'), (req, res) => {
  if (req.body.root_link) {
    const id = extractDriveId(req.body.root_link);
    if (!id) throw bad('Link folder Google Drive tidak valid.');
    setSetting('drive_root_id', id);
  }
  if (!isSyncing()) {
    setSetting('last_sync_error', '');
    syncFromDrive().catch(e => { console.error('Sync gagal', e); setSetting('last_sync_error', e.message); });
  }
  res.json({ started: true });
});

// Thumbnail proxy (Drive "anyone with link" files)
app.get('/api/thumb/:fileId', auth(), wrap(async (req, res) => {
  const buf = await getThumbnail(req.params.fileId, req.query.sz || 600);
  if (!buf) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400');
  res.type(buf[0] === 0x89 ? 'png' : 'jpeg').send(buf);
}));

// ---------- batch / expiry generator ----------
async function fetchSourcePdf(fileId, { fresh = false } = {}) {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(fileId)) throw bad('ID file tidak valid.');
  const p = path.join(SRC_DIR, fileId + '.pdf');
  try {
    if (!fresh && Date.now() - fs.statSync(p).mtimeMs < 30 * 60e3) return fs.readFileSync(p);
  } catch {}
  const res = await fetch(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`, {
    headers: { 'User-Agent': 'Mozilla/5.0 StickerRequestApp' }, redirect: 'follow',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buf.slice(0, 5).toString() !== '%PDF-') {
    throw bad('Gagal mengunduh file PDF dari Google Drive. Pastikan file berformat PDF dan dibagikan "Siapa saja yang memiliki link".');
  }
  fs.writeFileSync(p, buf);
  return buf;
}

function variantForGen(id) {
  const v = db.prepare(`SELECT v.*, p.code AS product_code, p.name AS product_name, b.name AS brand
    FROM variants v JOIN products p ON p.id = v.product_id JOIN brands b ON b.id = p.brand_id WHERE v.id = ?`).get(id);
  if (!v) throw new HttpError(404, 'Sticker tidak ditemukan.');
  if (!v.drive_file_id) throw bad('Sticker ini belum memiliki file Google Drive.');
  return v;
}

app.get('/api/generator/font', auth('admin'), (req, res) => res.json(fontInfo()));
app.post('/api/generator/font', auth('admin'), express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  const weight = req.query.weight === 'regular' ? 'regular' : 'bold';
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 1000) throw bad('File font kosong.');
  const sig = buf.slice(0, 4).toString('hex');
  if (!['00010000', '74727565', '4f54544f'].includes(sig)) throw bad('File harus berupa font TrueType/OpenType (.ttf/.otf).');
  fs.mkdirSync(FONT_DIR, { recursive: true });
  fs.writeFileSync(path.join(FONT_DIR, weight === 'bold' ? 'courbd.ttf' : 'cour.ttf'), buf);
  res.json(fontInfo());
});

app.post('/api/variants/:id/detect', auth('admin', 'desainer', 'manager_desain'), wrap(async (req, res) => {
  const v = variantForGen(req.params.id);
  const pdf = await fetchSourcePdf(v.drive_file_id, { fresh: !!req.body.fresh });
  const found = await detect(pdf);
  res.json({ found, file_name: v.file_name });
}));

app.post('/api/variants/:id/generate', auth('admin'), wrap(async (req, res) => {
  const v = variantForGen(req.params.id);
  const batch = str(req.body.batch, 40), exp = str(req.body.exp, 40);
  if (!batch && !exp) throw bad('Isi nomor batch dan/atau kode expired.');
  if (/[^\x20-\x7e]/.test(batch + exp)) throw bad('Gunakan huruf/angka standar saja.');
  const src = await fetchSourcePdf(v.drive_file_id, { fresh: true });
  let result;
  try { result = await replaceBatchExp(src, { batch, exp }); }
  catch (e) { if (e.code === 'NOT_FOUND') throw bad(e.message); throw e; }
  const uuid = crypto.randomUUID();
  const base = (v.file_name || v.name).replace(/\.pdf$/i, '').replace(/^(Salinan|Copy of)\s+/i, '');
  const fileName = `${base} - BN ${batch || '-'} EXP ${exp || '-'}.pdf`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
  fs.writeFileSync(path.join(GEN_DIR, uuid + '.pdf'), result.pdf);
  const gid = Number(db.prepare(`INSERT INTO generated_files(uuid, variant_id, source_file_id, file_name, batch_number, exp_code, replaced, size, created_by, created_by_name)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(uuid, v.id, v.drive_file_id, fileName, batch, exp, JSON.stringify(result.replaced), result.pdf.length, req.user.id, req.user.name).lastInsertRowid);
  const itemId = Number(req.body.request_item_id);
  if (itemId) {
    db.prepare('UPDATE request_items SET batch_number=?, exp_code=?, generated_id=? WHERE id=?').run(batch, exp, gid, itemId);
    const reqId = db.prepare('SELECT request_id FROM request_items WHERE id=?').get(itemId)?.request_id;
    if (reqId) db.prepare(`UPDATE requests SET updated_at=datetime('now') WHERE id=?`).run(reqId);
  }
  const url = `${baseUrl(req)}/files/${uuid}/${encodeURIComponent(fileName)}`;
  res.json({ id: gid, uuid, file_name: fileName, url, replaced: result.replaced, verify: result.verify, size: result.pdf.length });
}));

app.get('/api/generated', auth(), (req, res) => {
  const args = [];
  let where = '1=1';
  if (req.query.variant_id) { where = 'g.variant_id = ?'; args.push(Number(req.query.variant_id)); }
  const rows = db.prepare(`SELECT g.id, g.uuid, g.file_name, g.batch_number, g.exp_code, g.size, g.created_by_name, g.created_at, g.replaced,
      v.name AS variant_name, p.code AS product_code, p.name AS product_name, b.name AS brand
    FROM generated_files g LEFT JOIN variants v ON v.id = g.variant_id LEFT JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id
    WHERE ${where} ORDER BY g.id DESC LIMIT 100`).all(...args);
  res.json(rows.map(r => ({ ...r, replaced: JSON.parse(r.replaced || '[]'), url: `${baseUrl(req)}/files/${r.uuid}/${encodeURIComponent(r.file_name)}` })));
});

// Public (unguessable) download link for generated print files, so it can be forwarded to the vendor.
app.get('/files/:uuid/:name?', (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.uuid)) return res.status(404).send('File tidak ditemukan');
  const g = db.prepare('SELECT * FROM generated_files WHERE uuid = ?').get(req.params.uuid);
  const p = path.join(GEN_DIR, req.params.uuid + '.pdf');
  if (!g || !fs.existsSync(p)) return res.status(404).send('File tidak ditemukan');
  res.type('application/pdf');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(g.file_name)}`);
  res.sendFile(p);
});

// ---------- requests ----------
function nextRequestNumber(date) {
  const ym = date.slice(0, 7).replace('-', '');
  const prefix = `REQ-${ym}-`;
  const last = db.prepare('SELECT number FROM requests WHERE number LIKE ? ORDER BY number DESC LIMIT 1').get(prefix + '%');
  const n = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}

function loadRequest(id) {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!r) return null;
  r.items = db.prepare(`SELECT i.*, g.uuid AS generated_uuid, g.file_name AS generated_name, g.created_at AS generated_at
    FROM request_items i LEFT JOIN generated_files g ON g.id = i.generated_id WHERE i.request_id = ? ORDER BY i.id`).all(r.id);
  r.approvals = db.prepare('SELECT id, role, user_id, user_name, decision, note, signed_at, signature FROM approvals WHERE request_id = ?').all(r.id);
  r.purchase_requests = db.prepare(`SELECT id, number, supplier, vendor_name, pr_date, created_by_name, created_at FROM purchase_requests
    WHERE request_id = ? ORDER BY id DESC`).all(r.id);
  return r;
}
function canSee(user, r) {
  return user.role !== 'user' || r.requester_id === user.id;
}
function recomputeStatus(requestId) {
  const r = db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId);
  if (!['pending', 'approved', 'rejected'].includes(r.status)) return;
  const ap = db.prepare('SELECT role, decision FROM approvals WHERE request_id = ?').all(requestId);
  let status = 'pending';
  if (ap.some(a => a.decision === 'rejected')) status = 'rejected';
  else if (APPROVER_ROLES.every(role => ap.some(a => a.role === role && a.decision === 'approved'))) status = 'approved';
  db.prepare(`UPDATE requests SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, requestId);
}

app.post('/api/requests', auth(), (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw bad('Tambahkan minimal 1 sticker ke daftar request.');
  if (items.length > 100) throw bad('Maksimal 100 item per request.');
  const requestDate = /^\d{4}-\d{2}-\d{2}$/.test(b.request_date || '') ? b.request_date : today();
  const neededDate = /^\d{4}-\d{2}-\d{2}$/.test(b.needed_date || '') ? b.needed_date : '';
  const rows = items.map((it, i) => {
    const v = db.prepare(`SELECT v.*, p.code AS product_code, p.name AS product_name, b.name AS brand
      FROM variants v JOIN products p ON p.id = v.product_id JOIN brands b ON b.id = p.brand_id
      WHERE v.id = ? AND v.active = 1 AND p.active = 1`).get(Number(it.variant_id));
    if (!v) throw bad(`Item #${i + 1}: sticker tidak ditemukan.`);
    const qty = parseInt(it.qty, 10);
    if (!(qty > 0) || qty > 10_000_000) throw bad(`Item #${i + 1}: jumlah cetak tidak valid.`);
    let supplier = str(it.supplier, 100);
    if (!SUPPLIERS.includes(supplier)) throw bad(`Item #${i + 1}: pilih supplier.`);
    if (supplier === 'Lainnya') {
      const other = str(it.supplier_other, 100);
      if (!other) throw bad(`Item #${i + 1}: tuliskan nama supplier lainnya.`);
      supplier = `Lainnya: ${other}`;
    }
    return { v, qty, supplier, notes: str(it.notes, 500) };
  });
  const id = tx(() => {
    const number = nextRequestNumber(requestDate);
    const r = db.prepare(`INSERT INTO requests(number, requester_id, requester_name, division, request_date, needed_date, notes)
      VALUES(?,?,?,?,?,?,?)`).run(number, req.user.id, str(b.requester_name, 100) || req.user.name, str(b.division, 100) || req.user.division || '',
      requestDate, neededDate, str(b.notes, 2000));
    const rid = Number(r.lastInsertRowid);
    const ins = db.prepare(`INSERT INTO request_items(request_id, variant_id, brand, product_code, product_name, variant_name, dimension, volume,
      drive_file_id, drive_link, qty, supplier, notes, package_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const { v, qty, supplier, notes } of rows) {
      ins.run(rid, v.id, v.brand, v.product_code, v.product_name, v.name, v.dimension, v.volume, v.drive_file_id || '', v.drive_link, qty, supplier, notes, v.package_type);
    }
    return rid;
  });
  res.json(loadRequest(id));
});

app.get('/api/requests', auth(), (req, res) => {
  const where = [];
  const args = [];
  if (req.user.role === 'user' || req.query.mine) { where.push('r.requester_id = ?'); args.push(req.user.id); }
  if (req.query.status) { where.push('r.status = ?'); args.push(str(req.query.status, 20)); }
  if (req.query.from) { where.push('r.request_date >= ?'); args.push(str(req.query.from, 10)); }
  if (req.query.to) { where.push('r.request_date <= ?'); args.push(str(req.query.to, 10)); }
  if (req.query.q) {
    where.push(`(r.number LIKE ? OR r.requester_name LIKE ? OR EXISTS (SELECT 1 FROM request_items i WHERE i.request_id = r.id AND (i.product_name LIKE ? OR i.product_code LIKE ? OR i.brand LIKE ? OR i.supplier LIKE ?)))`);
    const like = `%${str(req.query.q, 100)}%`;
    args.push(like, like, like, like, like, like);
  }
  if (req.query.awaiting && APPROVER_ROLES.includes(req.user.role)) {
    where.push(`r.status = 'pending' AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.request_id = r.id AND a.role = ?)`);
    args.push(req.user.role);
  }
  const rows = db.prepare(`SELECT r.*,
      (SELECT COUNT(*) FROM request_items i WHERE i.request_id = r.id) AS item_count,
      (SELECT COALESCE(SUM(qty),0) FROM request_items i WHERE i.request_id = r.id) AS total_qty,
      (SELECT COUNT(*) FROM request_items i WHERE i.request_id = r.id AND i.generated_id IS NOT NULL) AS generated_count,
      (SELECT group_concat(DISTINCT i.brand) FROM request_items i WHERE i.request_id = r.id) AS brands,
      (SELECT group_concat(DISTINCT i.supplier) FROM request_items i WHERE i.request_id = r.id) AS suppliers,
      (SELECT group_concat(a.role || ':' || a.decision) FROM approvals a WHERE a.request_id = r.id) AS approval_summary
    FROM requests r ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.id DESC LIMIT ?`).all(...args, Math.min(Number(req.query.limit) || 200, 1000));
  res.json(rows);
});

app.get('/api/requests/:id', auth(), (req, res) => {
  const r = loadRequest(req.params.id);
  if (!r || !canSee(req.user, r)) throw new HttpError(404, 'Request tidak ditemukan.');
  res.json(r);
});

app.post('/api/requests/:id/approve', auth(...APPROVER_ROLES), (req, res) => {
  const r = loadRequest(req.params.id);
  if (!r) throw new HttpError(404, 'Request tidak ditemukan.');
  if (r.status !== 'pending' && r.status !== 'rejected') throw bad('Request ini sudah tidak menunggu persetujuan.');
  const decision = req.body.decision === 'rejected' ? 'rejected' : 'approved';
  const note = str(req.body.note, 500);
  let signature = String(req.body.signature || '') || req.user.signature || '';
  if (decision === 'approved') {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature)) throw bad('Tanda tangan wajib dibuat sebelum menyetujui.');
    if (req.body.save_signature) db.prepare('UPDATE users SET signature = ? WHERE id = ?').run(signature, req.user.id);
  } else {
    if (!note) throw bad('Tuliskan alasan penolakan.');
    signature = null;
  }
  db.prepare(`INSERT INTO approvals(request_id, role, user_id, user_name, decision, signature, note) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(request_id, role) DO UPDATE SET user_id=excluded.user_id, user_name=excluded.user_name, decision=excluded.decision,
    signature=excluded.signature, note=excluded.note, signed_at=datetime('now')`).run(r.id, req.user.role, req.user.id, req.user.name, decision, signature, note);
  recomputeStatus(r.id);
  res.json(loadRequest(r.id));
});

// Re-open a rejected request after it was fixed (admin) — clears approvals.
app.post('/api/requests/:id/reopen', auth('admin'), (req, res) => {
  const r = loadRequest(req.params.id);
  if (!r) throw new HttpError(404, 'Request tidak ditemukan.');
  if (!['rejected', 'approved'].includes(r.status)) throw bad('Hanya request yang ditolak / disetujui yang bisa diajukan ulang.');
  tx(() => {
    db.prepare('DELETE FROM approvals WHERE request_id = ?').run(r.id);
    db.prepare(`UPDATE requests SET status='pending', updated_at=datetime('now') WHERE id=?`).run(r.id);
  });
  res.json(loadRequest(r.id));
});

app.post('/api/requests/:id/status', auth('admin'), (req, res) => {
  const r = loadRequest(req.params.id);
  if (!r) throw new HttpError(404, 'Request tidak ditemukan.');
  const status = str(req.body.status, 20);
  const allowed = { sent: ['approved'], done: ['sent', 'approved'], cancelled: ['pending', 'rejected', 'approved'] };
  if (!allowed[status]) throw bad('Status tidak valid.');
  if (!allowed[status].includes(r.status)) {
    if (status === 'sent') throw bad('Request wajib disetujui & ditandatangani Desainer, Manager Desain, dan Purchasing sebelum diteruskan ke vendor.');
    throw bad(`Tidak bisa mengubah status dari "${STATUS_LABEL[r.status]}" ke "${STATUS_LABEL[status]}".`);
  }
  db.prepare(`UPDATE requests SET status=?, status_note=?, updated_at=datetime('now') WHERE id=?`).run(status, str(req.body.note, 500), r.id);
  res.json(loadRequest(r.id));
});

app.post('/api/requests/:id/cancel', auth(), (req, res) => {
  const r = loadRequest(req.params.id);
  if (!r || !canSee(req.user, r)) throw new HttpError(404, 'Request tidak ditemukan.');
  if (r.requester_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Hanya pemohon atau admin yang bisa membatalkan.');
  if (r.status !== 'pending') throw bad('Hanya request yang masih menunggu persetujuan yang bisa dibatalkan.');
  db.prepare(`UPDATE requests SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(r.id);
  res.json(loadRequest(r.id));
});

// Admin can adjust qty/supplier/batch of an item while the request is not yet sent.
app.put('/api/request-items/:id', auth('admin'), (req, res) => {
  const it = db.prepare('SELECT i.*, r.status FROM request_items i JOIN requests r ON r.id = i.request_id WHERE i.id = ?').get(req.params.id);
  if (!it) throw new HttpError(404, 'Item tidak ditemukan.');
  if (['sent', 'done', 'cancelled'].includes(it.status)) throw bad('Request sudah dikirim/selesai, item tidak bisa diubah.');
  const b = req.body;
  const qty = b.qty !== undefined ? parseInt(b.qty, 10) : it.qty;
  if (!(qty > 0)) throw bad('Jumlah tidak valid.');
  let supplier = b.supplier !== undefined ? str(b.supplier, 100) : it.supplier;
  if (b.supplier !== undefined) {
    if (!SUPPLIERS.includes(supplier)) throw bad('Supplier tidak valid.');
    if (supplier === 'Lainnya') { const o = str(b.supplier_other, 100); if (!o) throw bad('Tuliskan nama supplier.'); supplier = `Lainnya: ${o}`; }
  }
  db.prepare('UPDATE request_items SET qty=?, supplier=?, batch_number=?, exp_code=? WHERE id=?').run(
    qty, supplier, b.batch_number !== undefined ? str(b.batch_number, 40) : it.batch_number, b.exp_code !== undefined ? str(b.exp_code, 40) : it.exp_code, it.id);
  res.json({ ok: true });
});

// ---------- company letterhead & vendors ----------
const COMPANY_KEYS = ['company_name', 'company_tagline', 'company_address', 'company_phone', 'company_email', 'company_website', 'company_npwp',
  'pr_city', 'pr_delivery_address', 'pr_payment_terms', 'pr_terms'];
const COMPANY_DEFAULTS = {
  company_name: 'PT SAINSGO KARYA INDONESIA',
  pr_city: 'Jakarta',
  pr_payment_terms: 'Sesuai kesepakatan',
  pr_terms: [
    'Barang dicetak sesuai file cetak terlampir (link file siap cetak) beserta ukuran, bahan, dan jumlah pada tabel di atas.',
    'Vendor wajib mengirimkan proof/sampel cetak untuk disetujui sebelum produksi massal.',
    'Nomor batch dan tanggal kedaluwarsa harus sesuai file cetak. Kesalahan cetak menjadi tanggung jawab vendor.',
    'Mohon cantumkan nomor Purchase Request ini pada surat jalan dan invoice.',
  ].join('\n'),
};
function companySettings() {
  const out = {};
  for (const k of COMPANY_KEYS) out[k] = getSetting(k, COMPANY_DEFAULTS[k] || '');
  out.company_logo = getSetting('company_logo', '');
  return out;
}
app.get('/api/settings/company', auth('admin', 'purchasing'), (req, res) => res.json(companySettings()));
app.put('/api/settings/company', auth('admin'), (req, res) => {
  for (const k of COMPANY_KEYS) if (req.body[k] !== undefined) setSetting(k, str(req.body[k], 3000));
  if (req.body.company_logo !== undefined) {
    const logo = String(req.body.company_logo || '');
    if (logo && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw bad('Logo harus berupa gambar PNG atau JPG.');
    if (logo.length > 2_000_000) throw bad('Ukuran logo maksimal ±1,5 MB.');
    setSetting('company_logo', logo);
  }
  res.json(companySettings());
});
app.get('/api/vendors', auth('admin', 'purchasing'), (req, res) => res.json(db.prepare('SELECT * FROM vendors ORDER BY name').all()));

// ---------- purchase requests (to vendor) ----------
const supplierToVendor = s => String(s || '').replace(/^Lainnya:\s*/, '');
function nextPrNumber(date) {
  const [y, m] = date.split('-');
  const prefix = `PR/SKI/${y}/${m}/`;
  const last = db.prepare('SELECT number FROM purchase_requests WHERE number LIKE ? ORDER BY number DESC LIMIT 1').get(prefix + '%');
  return prefix + String(last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1).padStart(4, '0');
}
function loadPr(id) {
  const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
  if (!pr) return null;
  pr.items = JSON.parse(pr.items || '[]');
  return pr;
}

app.get('/api/requests/:id/purchase-requests/draft', auth('admin', 'purchasing'), (req, res) => {
  const r = loadRequest(req.params.id);
  if (!r) throw new HttpError(404, 'Request tidak ditemukan.');
  const supplier = str(req.query.supplier, 100);
  const vendorName = supplierToVendor(supplier);
  const vendor = db.prepare('SELECT * FROM vendors WHERE name = ?').get(vendorName) || { name: vendorName };
  const c = companySettings();
  res.json({
    supplier, vendor, pr_date: today(), delivery_date: r.needed_date || '',
    delivery_address: c.pr_delivery_address || c.company_address, payment_terms: c.pr_payment_terms,
    items: r.items.filter(i => i.supplier === supplier),
  });
});

app.post('/api/requests/:id/purchase-requests', auth('admin', 'purchasing'), (req, res) => {
  const r = loadRequest(req.params.id);
  if (!r) throw new HttpError(404, 'Request tidak ditemukan.');
  if (!['approved', 'sent', 'done'].includes(r.status)) {
    throw bad('Purchase Request hanya bisa dibuat setelah request disetujui & ditandatangani Desainer, Manager Desain, dan Purchasing.');
  }
  const b = req.body;
  const supplier = str(b.supplier, 100);
  const srcItems = r.items.filter(i => i.supplier === supplier);
  if (!srcItems.length) throw bad('Tidak ada item untuk supplier ini.');
  const vendorName = str(b.vendor_name, 150) || supplierToVendor(supplier);
  const prDate = /^\d{4}-\d{2}-\d{2}$/.test(b.pr_date || '') ? b.pr_date : today();
  const overrides = new Map((Array.isArray(b.items) ? b.items : []).map(x => [Number(x.id), x]));
  const items = srcItems.map(it => {
    const o = overrides.get(it.id) || {};
    const qty = o.qty !== undefined ? parseInt(o.qty, 10) : it.qty;
    if (!(qty > 0)) throw bad(`Jumlah untuk ${it.product_name} tidak valid.`);
    const price = o.unit_price === '' || o.unit_price == null ? null : Number(String(o.unit_price).replace(/[^\d.]/g, ''));
    if (price !== null && !(price >= 0)) throw bad(`Harga untuk ${it.product_name} tidak valid.`);
    return {
      id: it.id, brand: it.brand, product_code: it.product_code, product_name: it.product_name, variant_name: it.variant_name,
      package_type: it.package_type, dimension: it.dimension, volume: it.volume, batch_number: it.batch_number, exp_code: it.exp_code,
      drive_link: it.drive_link, drive_file_id: it.drive_file_id, generated_uuid: it.generated_uuid, generated_name: it.generated_name,
      qty, unit: str(o.unit, 20) || 'pcs', unit_price: price, spec: str(o.spec, 300) || it.notes || '',
    };
  });
  const tax = Math.min(Math.max(Number(b.tax_percent) || 0, 0), 100);
  const id = tx(() => {
    const number = nextPrNumber(prDate);
    const rr = db.prepare(`INSERT INTO purchase_requests(number, request_id, supplier, vendor_name, vendor_address, vendor_contact, vendor_phone, vendor_email,
      pr_date, delivery_date, delivery_address, payment_terms, notes, tax_percent, items, created_by, created_by_name)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(number, r.id, supplier, vendorName, str(b.vendor_address, 500), str(b.vendor_contact, 100),
      str(b.vendor_phone, 50), str(b.vendor_email, 100), prDate, /^\d{4}-\d{2}-\d{2}$/.test(b.delivery_date || '') ? b.delivery_date : '',
      str(b.delivery_address, 500), str(b.payment_terms, 200), str(b.notes, 2000), tax, JSON.stringify(items), req.user.id, req.user.name);
    db.prepare(`INSERT INTO vendors(name, address, contact_person, phone, email) VALUES(?,?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET address=excluded.address, contact_person=excluded.contact_person, phone=excluded.phone,
      email=excluded.email, updated_at=datetime('now')`).run(vendorName, str(b.vendor_address, 500), str(b.vendor_contact, 100), str(b.vendor_phone, 50), str(b.vendor_email, 100));
    return Number(rr.lastInsertRowid);
  });
  const pr = loadPr(id);
  res.json({ ...pr, pdf_url: `/api/purchase-requests/${id}/pdf` });
});

app.get('/api/purchase-requests', auth('admin', 'purchasing', 'manager_desain', 'desainer'), (req, res) => {
  res.json(db.prepare(`SELECT pr.id, pr.number, pr.supplier, pr.vendor_name, pr.pr_date, pr.created_by_name, pr.created_at, r.number AS request_number, r.id AS request_id
    FROM purchase_requests pr JOIN requests r ON r.id = pr.request_id ORDER BY pr.id DESC LIMIT 200`).all());
});

app.get('/api/purchase-requests/:id/pdf', auth('admin', 'purchasing', 'manager_desain', 'desainer'), wrap(async (req, res) => {
  const pr = loadPr(req.params.id);
  if (!pr) throw new HttpError(404, 'Purchase Request tidak ditemukan.');
  const r = loadRequest(pr.request_id);
  res.type('application/pdf');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${pr.number.replace(/\//g, '-')}.pdf"`);
  const creatorSignature = db.prepare('SELECT signature FROM users WHERE id = ?').get(pr.created_by)?.signature || null;
  await sendPdf(res, out => purchasePdf(out, { pr, request: r, company: companySettings(), baseUrl: baseUrl(req), creatorSignature }));
}));

// ---------- PDF reports ----------
app.get('/api/requests/:id/pdf', auth(), wrap(async (req, res) => {
  const r = loadRequest(req.params.id);
  if (!r || !canSee(req.user, r)) throw new HttpError(404, 'Request tidak ditemukan.');
  const supplier = str(req.query.supplier, 100);
  res.type('application/pdf');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${r.number}${supplier ? '-' + supplier.replace(/[^A-Za-z0-9]+/g, '_') : ''}.pdf"`);
  await sendPdf(res, out => requestPdf(out, { request: r, items: r.items, approvals: r.approvals, baseUrl: baseUrl(req), supplier }));
}));

app.get('/api/reports/pdf', auth('admin', ...APPROVER_ROLES), wrap(async (req, res) => {
  const where = [], args = [];
  const from = str(req.query.from, 10), to = str(req.query.to, 10), status = str(req.query.status, 20);
  if (from) { where.push('request_date >= ?'); args.push(from); }
  if (to) { where.push('request_date <= ?'); args.push(to); }
  if (status) { where.push('status = ?'); args.push(status); }
  const ids = db.prepare(`SELECT id FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY request_date, id`).all(...args);
  const requests = ids.map(x => loadRequest(x.id));
  res.type('application/pdf');
  res.set('Content-Disposition', `inline; filename="laporan-request-sticker-${from || 'awal'}-${to || today()}.pdf"`);
  await sendPdf(res, out => recapPdf(out, { requests, from, to, status, baseUrl: baseUrl(req) }));
}));

app.get('/api/stats', auth(), (req, res) => {
  const mine = req.user.role === 'user' ? 'WHERE requester_id = ' + Number(req.user.id) : '';
  const byStatus = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) n FROM requests ${mine} GROUP BY status`).all().map(r => [r.status, r.n]));
  res.json({
    byStatus,
    products: db.prepare('SELECT COUNT(*) n FROM products WHERE active=1').get().n,
    variants: db.prepare('SELECT COUNT(*) n FROM variants WHERE active=1').get().n,
    brands: db.prepare('SELECT COUNT(*) n FROM brands WHERE active=1').get().n,
    awaiting_me: APPROVER_ROLES.includes(req.user.role) ? db.prepare(`SELECT COUNT(*) n FROM requests r WHERE r.status='pending'
      AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.request_id=r.id AND a.role=?)`).get(req.user.role).n : 0,
  });
});

// ---------- static & errors ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: status >= 500 ? 'Terjadi kesalahan server: ' + err.message : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Sistem Request Cetak Sticker berjalan di http://localhost:${PORT}`));
}
module.exports = app;
