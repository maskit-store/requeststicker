// Batch numbering per POB/KO/PD/001.01 "Sistem Penomoran Batch":
//   digits 1-2 = production month, 3-4 = production year, 5-6 = production sequence, 7-9 = SKU code (e.g. 042602A01)
// Expiry printed on the sticker = production month + shelf life (months) + 1 month reserve, formatted MM-YYYY.
// SKU codes live in the Google Sheet "Numerik Sticker" (tab "KODE SKU"); the app keeps a copy per product.
const fs = require('fs');
const path = require('path');
const { db, getSetting, setSetting } = require('./db');

const SHEET_ID = process.env.SKU_SHEET_ID || '1NYLVmOl3EfQafDhTrdHqpMpl3rwFJj1xcFh-w-AStP0';
const SHEET_TABS = {
  'KODE SKU': 1275851335,
  'Nomor Batch': 1605777592,
  Maskit: 0, Wonderpaw: 458193234, Twinbi: 1333184746, "Dotty's": 391543773, DERMEON: 1596520942,
  'Ayree (MAKLON)': 410097597, IndoGredient: 101000220, Safare: 1121416473,
  'Tumgo (OT)': 1254877767, 'Nafazy (OT)': 1416677322, 'Ceranova (OT)': 346001893,
};
// app brand name → brand tab in the sheet
const BRAND_TAB = {
  Maskit: 'Maskit', Wonderpaw: 'Wonderpaw', Twinbi: 'Twinbi', "Dotty's Lab": "Dotty's", Dermeon: 'DERMEON',
  'MaklonGo - Ayree': 'Ayree (MAKLON)', IndoGredient: 'IndoGredient', Safare: 'Safare',
  Tumgo: 'Tumgo (OT)', Nafazy: 'Nafazy (OT)', Ceranova: 'Ceranova (OT)',
};

const SKU_RE = /^[A-Z]\d{2}$/;
const skuToInt = c => (c.charCodeAt(0) - 65) * 99 + parseInt(c.slice(1), 10) - 1;
const intToSku = n => String.fromCharCode(65 + Math.floor(n / 99)) + String(n % 99 + 1).padStart(2, '0');

// ---------- batch & expiry ----------
function buildBatch({ prodDate, seq, sku }) {
  const m = /^(\d{4})-(\d{2})/.exec(prodDate || '');
  if (!m) throw new Error('Tanggal produksi tidak valid.');
  if (!SKU_RE.test(sku || '')) throw new Error('Kode SKU harus 1 huruf + 2 angka, mis. A01.');
  const s = parseInt(seq, 10);
  if (!(s >= 1 && s <= 99)) throw new Error('Urutan produksi harus 1–99.');
  return `${m[2]}${m[1].slice(2)}${String(s).padStart(2, '0')}${sku}`;
}
function buildExp(prodDate, shelfMonths, reserveMonths = 1) {
  const m = /^(\d{4})-(\d{2})/.exec(prodDate || '');
  const n = parseInt(shelfMonths, 10);
  if (!m) throw new Error('Tanggal produksi tidak valid.');
  if (!(n >= 1 && n <= 120)) throw new Error('Masa simpan harus 1–120 bulan.');
  const total = parseInt(m[1], 10) * 12 + (parseInt(m[2], 10) - 1) + n + reserveMonths;
  return `${String(total % 12 + 1).padStart(2, '0')}-${Math.floor(total / 12)}`;
}

// ---------- public sheet reads (CSV export, no credentials needed) ----------
const cache = new Map();
async function sheetCsv(tab, maxAgeMs = 5 * 60e3) {
  const gid = SHEET_TABS[tab];
  if (gid === undefined || process.env.SKU_SHEET_OFFLINE) return null;
  const hit = cache.get(tab);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.rows;
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Gagal membaca Google Sheet (${res.status})`);
  const rows = parseCsv(await res.text());
  cache.set(tab, { at: Date.now(), rows });
  return rows;
}
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// Batch numbers already issued according to the sheet's "Nomor Batch" register.
async function sheetBatches() {
  try {
    const rows = await sheetCsv('Nomor Batch');
    const out = [];
    for (const r of rows || []) for (const cell of r) {
      for (const m of String(cell).matchAll(/BN\.?\s*(\d{2})(\d{2})(\d{2})([A-Z]\d{2})/g)) {
        out.push({ batch: `${m[1]}${m[2]}${m[3]}${m[4]}`, prod_month: `20${m[2]}-${m[1]}`, seq: parseInt(m[3], 10), sku: m[4] });
      }
    }
    return out;
  } catch { return []; }
}
async function sheetSkuCodes() {
  try { return (await sheetCsv('KODE SKU')).map(r => (r[4] || '').trim()).filter(c => SKU_RE.test(c)); } catch { return []; }
}
async function sheetBrandCodes(brand) {
  const tab = BRAND_TAB[brand];
  if (!tab) return [];
  try {
    const rows = await sheetCsv(tab);
    const codes = [];
    for (const r of rows || []) for (const c of r) if (/^[A-Z]{1,3}\d{3}$/.test(String(c).trim())) codes.push(String(c).trim());
    return codes;
  } catch { return []; }
}

// ---------- suggestions ----------
async function nextSeq(prodMonth, requestId) {
  if (requestId) {
    const same = db.prepare('SELECT seq FROM batch_records WHERE request_id = ? AND prod_month = ? ORDER BY id DESC LIMIT 1').get(requestId, prodMonth);
    if (same) return { seq: same.seq, reason: 'sama dengan item lain di request ini (satu kali produksi)' };
  }
  const local = db.prepare('SELECT MAX(seq) m FROM batch_records WHERE prod_month = ?').get(prodMonth).m || 0;
  const sheet = (await sheetBatches()).filter(b => b.prod_month === prodMonth).reduce((a, b) => Math.max(a, b.seq), 0);
  return { seq: Math.max(local, sheet) + 1, reason: `urutan produksi berikutnya di bulan ini (terakhir: ${Math.max(local, sheet) || '-'})` };
}
async function batchExists(batch) {
  if (db.prepare('SELECT 1 FROM batch_records WHERE batch = ?').get(batch)) return 'aplikasi';
  if ((await sheetBatches()).some(b => b.batch === batch)) return 'Google Sheet (Nomor Batch)';
  return null;
}
async function nextSkuCode() {
  const all = [...db.prepare("SELECT sku_code FROM products WHERE sku_code <> ''").all().map(r => r.sku_code), ...(await sheetSkuCodes())]
    .filter(c => SKU_RE.test(c));
  return intToSku(all.reduce((a, c) => Math.max(a, skuToInt(c)), -1) + 1);
}
async function nextProductCode(brandId, brandName, prefixHint) {
  const local = db.prepare("SELECT code FROM products WHERE brand_id = ? AND code <> ''").all(brandId).map(r => r.code);
  const all = [...local, ...(await sheetBrandCodes(brandName))].filter(c => /^[A-Z]{1,3}\d{3}$/.test(c));
  const counts = {};
  for (const c of all) { const p = c.replace(/\d+$/, ''); counts[p] = (counts[p] || 0) + 1; }
  const prefix = (prefixHint || Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '').toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(prefix)) return null;
  const max = all.filter(c => c.replace(/\d+$/, '') === prefix).reduce((a, c) => Math.max(a, parseInt(c.slice(prefix.length), 10)), 0);
  return prefix + String(max + 1).padStart(3, '0');
}

// ---------- seed mapping: Kode Numerik → SKU (prepared from the sheet) ----------
function applySeedSkuMap() {
  const file = path.join(__dirname, '..', 'seed', 'sku-map.json');
  if (!fs.existsSync(file)) return 0;
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  const upd = db.prepare("UPDATE products SET sku_code = ? WHERE code = ? AND (sku_code IS NULL OR sku_code = '')");
  let n = 0;
  for (const [code, sku] of Object.entries(map)) n += Number(upd.run(sku, code).changes || 0);
  return n;
}

// ---------- writing to the sheet via a Google Apps Script web app ----------
function sheetWebhook() {
  return { url: getSetting('sheet_webhook_url', '') || process.env.SHEET_WEBHOOK_URL || '', token: getSetting('sheet_webhook_token', '') || process.env.SHEET_WEBHOOK_TOKEN || '' };
}
async function callWebhook(action, payload) {
  const { url, token } = sheetWebhook();
  if (!url) throw new Error('Webhook Google Sheet belum diatur.');
  const res = await fetch(url, {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, action, ...payload }),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error('Respon webhook tidak valid: ' + text.slice(0, 120)); }
  if (!data.ok) throw new Error(data.error || 'Webhook menolak permintaan.');
  cache.clear();
  return data;
}
function queueSheet(action, payload) {
  const id = Number(db.prepare('INSERT INTO sheet_outbox(action, payload) VALUES(?, ?)').run(action, JSON.stringify(payload)).lastInsertRowid);
  flushOutbox().catch(() => {});
  return id;
}
let flushing = null;
async function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!sheetWebhook().url) return;
    for (const job of db.prepare("SELECT * FROM sheet_outbox WHERE status <> 'sent' ORDER BY id LIMIT 50").all()) {
      try {
        await callWebhook(job.action, JSON.parse(job.payload));
        db.prepare("UPDATE sheet_outbox SET status='sent', error='', sent_at=datetime('now') WHERE id=?").run(job.id);
      } catch (e) {
        db.prepare("UPDATE sheet_outbox SET status='error', error=? WHERE id=?").run(String(e.message).slice(0, 300), job.id);
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

module.exports = {
  SHEET_ID, BRAND_TAB, SKU_RE, buildBatch, buildExp, nextSeq, batchExists, nextSkuCode, nextProductCode,
  applySeedSkuMap, sheetWebhook, callWebhook, queueSheet, flushOutbox, setSetting, skuToInt, intToSku, parseCsv,
};
