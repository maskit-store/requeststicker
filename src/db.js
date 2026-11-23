const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

process.removeAllListeners('warning');
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user','manager_desain','purchasing','desainer')),
  division TEXT DEFAULT '',
  signature TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  drive_folder_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  code TEXT DEFAULT '',
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  volume TEXT DEFAULT '',
  drive_key TEXT UNIQUE,
  drive_link TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dimension TEXT DEFAULT '',
  volume TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  drive_file_id TEXT UNIQUE,
  drive_link TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  file_type TEXT DEFAULT '',
  alt_files TEXT DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  requester_id INTEGER REFERENCES users(id),
  requester_name TEXT NOT NULL,
  division TEXT DEFAULT '',
  request_date TEXT NOT NULL,
  needed_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','sent','done','cancelled')),
  status_note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS generated_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,
  variant_id INTEGER REFERENCES variants(id) ON DELETE SET NULL,
  source_file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  batch_number TEXT DEFAULT '',
  exp_code TEXT DEFAULT '',
  replaced TEXT DEFAULT '[]',
  size INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_by_name TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES variants(id) ON DELETE SET NULL,
  brand TEXT NOT NULL,
  product_code TEXT DEFAULT '',
  product_name TEXT NOT NULL,
  variant_name TEXT DEFAULT '',
  dimension TEXT DEFAULT '',
  volume TEXT DEFAULT '',
  drive_file_id TEXT DEFAULT '',
  drive_link TEXT DEFAULT '',
  qty INTEGER NOT NULL CHECK (qty > 0),
  supplier TEXT NOT NULL,
  notes TEXT DEFAULT '',
  batch_number TEXT DEFAULT '',
  exp_code TEXT DEFAULT '',
  generated_id INTEGER REFERENCES generated_files(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_items_request ON request_items(request_id);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  user_name TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  signature TEXT,
  note TEXT DEFAULT '',
  signed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_id, role)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// ---- helpers ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const buf = Buffer.from(hash, 'hex');
  return buf.length === test.length && crypto.timingSafeEqual(buf, test);
}

function getSetting(key, def = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : def;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, hashPassword, verifyPassword, getSetting, setSetting, tx, DATA_DIR };
