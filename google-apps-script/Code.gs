/**
 * Request Sticker — penghubung ke Google Sheet "Numerik Sticker".
 *
 * Dipasang SEKALI dari Google Sheet: Ekstensi → Apps Script → tempel file ini → ganti TOKEN →
 * Terapkan (Deploy) → Penerapan baru → Jenis: Aplikasi web → Jalankan sebagai: Saya → Akses: Siapa saja → Terapkan.
 * Salin URL ".../exec" dan TOKEN ke aplikasi (menu Kop Surat & PR → Koneksi Google Sheet).
 *
 * Aksi yang dikirim aplikasi:
 *   ping          — tes koneksi
 *   appendProduct — produk baru → baris baru di tab brand (No, Nama, Ukuran, Volume, Kode Numerik)
 *   appendSku     — kode SKU baru → baris baru di tab "KODE SKU"
 *   appendBatch   — nomor batch yang diterbitkan → baris baru di tab "Nomor Batch" (POB/KO/PD/001.01 butir 4.3)
 * Script hanya MENAMBAH baris di bawah data terakhir; tidak pernah mengubah/menghapus baris yang sudah ada.
 */
const TOKEN = 'GANTI-DENGAN-TOKEN-RAHASIA-ANDA';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (!TOKEN || body.token !== TOKEN) return out({ ok: false, error: 'Token salah.' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    switch (body.action) {
      case 'ping': return out({ ok: true, spreadsheet: ss.getName() });
      case 'appendProduct': return out(appendProduct(ss, body));
      case 'appendSku': return out(appendSku(ss, body));
      case 'appendBatch': return out(appendBatch(ss, body));
      default: return out({ ok: false, error: 'Aksi tidak dikenal: ' + body.action });
    }
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}
function doGet() { return out({ ok: true, info: 'Request Sticker webhook aktif. Gunakan POST.' }); }

function out(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Cari baris judul (berisi kolom kode) dan petakan nama kolom → nomor kolom (1-based).
function headerMap(sheet, codeHeader) {
  const values = sheet.getRange(1, 1, Math.min(sheet.getLastRow(), 15), sheet.getLastColumn()).getValues();
  for (let r = 0; r < values.length; r++) {
    const row = values[r].map(norm);
    const codeCol = row.indexOf(norm(codeHeader));
    if (codeCol < 0) continue;
    const find = (...names) => { for (const n of names) { const i = row.findIndex(c => c.indexOf(n) === 0); if (i >= 0) return i + 1; } return 0; };
    return {
      headerRow: r + 1, code: codeCol + 1,
      no: find('no'), name: find('nama produk', 'nama sticker', 'nama'), size: find('ukuran', 'size kemasan'), volume: find('volume'),
    };
  }
  throw new Error(`Kolom "${codeHeader}" tidak ditemukan di tab ${sheet.getName()}.`);
}
function lastDataRow(sheet, col, fromRow) {
  const n = sheet.getLastRow();
  if (n <= fromRow) return fromRow;
  const vals = sheet.getRange(fromRow + 1, col, n - fromRow, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim() !== '') return fromRow + 1 + i;
  return fromRow;
}
function codeExists(sheet, col, fromRow, code) {
  const n = sheet.getLastRow();
  if (n <= fromRow) return false;
  return sheet.getRange(fromRow + 1, col, n - fromRow, 1).getValues().some(v => String(v[0]).trim() === code);
}
function writeRow(sheet, h, row, data) {
  const set = (col, v) => { if (col) sheet.getRange(row, col).setValue(v); };
  if (h.no) {
    const prev = row > h.headerRow + 1 ? Number(sheet.getRange(row - 1, h.no).getValue()) : 0;
    set(h.no, prev > 0 ? prev + 1 : '');
  }
  set(h.name, data.name); set(h.size, data.size); set(h.volume, data.volume); set(h.code, data.code);
}

function appendProduct(ss, b) {
  const sheet = ss.getSheetByName(b.tab);
  if (!sheet) throw new Error(`Tab "${b.tab}" tidak ada. Tambahkan tab brand ${b.brand} terlebih dahulu.`);
  const h = headerMap(sheet, 'Kode Numerik');
  if (codeExists(sheet, h.code, h.headerRow, b.kode_numerik)) return { ok: true, skipped: 'sudah ada' };
  const row = Math.max(lastDataRow(sheet, h.code, h.headerRow), lastDataRow(sheet, h.name, h.headerRow)) + 1;
  writeRow(sheet, h, row, { name: b.name, size: b.size, volume: b.volume, code: b.kode_numerik });
  return { ok: true, tab: sheet.getName(), row };
}

function appendSku(ss, b) {
  const sheet = ss.getSheetByName('KODE SKU');
  if (!sheet) throw new Error('Tab "KODE SKU" tidak ditemukan.');
  const h = headerMap(sheet, 'Kode SKU');
  if (!h.no) h.no = 1;
  if (codeExists(sheet, h.code, h.headerRow, b.sku)) return { ok: true, skipped: 'sudah ada' };
  const row = Math.max(lastDataRow(sheet, h.code, h.headerRow), lastDataRow(sheet, h.name, h.headerRow)) + 1;
  writeRow(sheet, h, row, { name: b.name, size: b.size, volume: b.volume, code: b.sku });
  return { ok: true, tab: sheet.getName(), row };
}

function appendBatch(ss, b) {
  const sheet = ss.getSheetByName('Nomor Batch');
  if (!sheet) throw new Error('Tab "Nomor Batch" tidak ditemukan.');
  const text = `BN.${b.batch}\nEXP.${b.exp}`;
  const n = sheet.getLastRow();
  // Kolom: Merek | Nama Produk | Volume | Nomor Batch | Jumlah | Supplier
  const existing = n > 0 ? sheet.getRange(1, 4, n, 1).getValues() : [];
  if (existing.some(v => String(v[0]).replace(/\s+/g, '') === text.replace(/\s+/g, ''))) return { ok: true, skipped: 'sudah ada' };
  let row = n;
  while (row > 1 && sheet.getRange(row, 1, 1, 6).getValues()[0].every(v => String(v).trim() === '')) row--;
  row++;
  sheet.getRange(row, 1, 1, 6).setValues([[b.brand || '', b.product || '', b.volume || '', text, b.qty || '', b.supplier || '']]);
  return { ok: true, tab: sheet.getName(), row };
}
