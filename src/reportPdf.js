const PDFDocument = require('pdfkit');
const { getThumbnail, imageKind } = require('./thumbs');
const PACKAGE_LABEL = { sticker: 'Sticker / Label', flexible: 'Flexible Packaging', box: 'Box / Karton', other: 'Lainnya' };

const ROLE_LABEL = { desainer: 'Desainer', manager_desain: 'Manager Desain', purchasing: 'Purchasing' };
const APPROVER_ROLES = ['desainer', 'purchasing'];
const STATUS_LABEL = {
  pending: 'Menunggu Persetujuan', approved: 'Disetujui', rejected: 'Ditolak',
  sent: 'Dikirim ke Vendor', done: 'Selesai', cancelled: 'Dibatalkan',
};
const C = { ink: '#1f2937', muted: '#6b7280', line: '#d1d5db', head: '#111827', accent: '#0f766e', soft: '#f3f4f6', link: '#1d4ed8', red: '#b91c1c' };

function fmtDate(s, withTime = false) {
  if (!s) return '-';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + (s.includes('Z') || s.length <= 10 ? '' : 'Z'));
  if (isNaN(d)) return s;
  const opts = { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('id-ID', opts) + (withTime ? ' WIB' : '');
}

function dataUrlToBuffer(u) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(u || '');
  return m ? Buffer.from(m[2], 'base64') : null;
}

async function loadThumbs(items) {
  const out = new Map();
  await Promise.all(items.map(async it => {
    if (!it.drive_file_id) return;
    const buf = await getThumbnail(it.drive_file_id, 400).catch(() => null);
    if (buf && imageKind(buf)) out.set(it.id, buf);
  }));
  return out;
}

function header(doc, title, subtitle) {
  const { left, right } = doc.page.margins;
  const w = doc.page.width - left - right;
  doc.rect(left, 28, w, 3).fill(C.accent);
  doc.fillColor(C.head).font('Helvetica-Bold').fontSize(16).text(title, left, 40, { width: w });
  if (subtitle) doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(subtitle, left, doc.y + 2, { width: w });
  doc.moveDown(0.6);
}

/** Single request summary for the vendor, with approval/signature block. */
async function requestPdf(stream, { request, items, approvals, baseUrl, supplier }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, info: { Title: `Request Cetak Sticker ${request.number}` } });
  doc.pipe(stream);
  const list = supplier ? items.filter(i => i.supplier === supplier) : items;
  const thumbs = await loadThumbs(list);
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;

  header(doc, 'RINGKASAN REQUEST CETAK STICKER KEMASAN',
    `No. ${request.number}${supplier ? '  ·  Supplier: ' + supplier : ''}  ·  Dicetak ${fmtDate(new Date().toISOString(), true)}`);

  // meta block
  const meta = [
    ['Nomor Request', request.number], ['Tanggal Request', fmtDate(request.request_date)],
    ['Pemohon', request.requester_name + (request.division ? ` (${request.division})` : '')],
    ['Dibutuhkan Tanggal', request.needed_date ? fmtDate(request.needed_date) : '-'],
    ['Status', STATUS_LABEL[request.status] || request.status], ['Total Item', `${list.length} item · ${list.reduce((a, b) => a + b.qty, 0).toLocaleString('id-ID')} pcs`],
  ];
  const y0 = doc.y;
  const colW = W / 3;
  meta.forEach(([k, v], i) => {
    const x = left + (i % 3) * colW, y = y0 + Math.floor(i / 3) * 30;
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(k.toUpperCase(), x, y, { width: colW - 10 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(k === 'Status' && request.status === 'rejected' ? C.red : C.ink).text(v, x, y + 10, { width: colW - 10, lineBreak: false, ellipsis: true });
  });
  doc.y = y0 + 64;
  if (request.notes) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted).text('CATATAN: ', left, doc.y, { continued: true })
      .font('Helvetica').fillColor(C.ink).text(request.notes, { width: W });
    doc.moveDown(0.5);
  }

  // table
  const cols = [
    { k: 'no', t: 'No', w: 24 }, { k: 'img', t: 'Visual', w: 74 }, { k: 'prod', t: 'Brand / Produk / Variasi', w: 196 },
    { k: 'dim', t: 'Ukuran', w: 72 }, { k: 'qty', t: 'Jumlah', w: 56 }, { k: 'sup', t: 'Supplier', w: 86 },
    { k: 'bn', t: 'Batch / Exp', w: 92 }, { k: 'link', t: 'File', w: W - 600 },
  ];
  const drawHead = () => {
    const y = doc.y;
    doc.rect(left, y, W, 18).fill(C.head);
    let x = left;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff');
    for (const c of cols) { doc.text(c.t, x + 4, y + 5, { width: c.w - 8 }); x += c.w; }
    doc.y = y + 18;
  };
  drawHead();
  const rowH = 70;
  list.forEach((it, i) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 10) { doc.addPage(); drawHead(); }
    const y = doc.y;
    if (i % 2) doc.rect(left, y, W, rowH).fill(C.soft);
    let x = left;
    const cell = (c, fn) => { fn(x + 4, y + 6, c.w - 8); x += c.w; };
    doc.fillColor(C.ink);
    cell(cols[0], (cx, cy, w) => doc.font('Helvetica-Bold').fontSize(9).text(String(i + 1), cx, cy, { width: w }));
    cell(cols[1], (cx, cy, w) => {
      const buf = thumbs.get(it.id);
      if (buf) { try { doc.image(buf, cx, cy - 2, { fit: [w, rowH - 8], align: 'center', valign: 'center' }); } catch {} }
      else doc.font('Helvetica').fontSize(7).fillColor(C.muted).text('(tidak ada pratinjau)', cx, cy + 20, { width: w, align: 'center' });
    });
    cell(cols[2], (cx, cy, w) => {
      doc.font('Helvetica').fontSize(7.5).fillColor(C.accent).text(`${it.brand.toUpperCase()}  ·  ${(PACKAGE_LABEL[it.package_type] || 'Sticker / Label').toUpperCase()}`, cx, cy, { width: w });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(`${it.product_code ? it.product_code + '. ' : ''}${it.product_name}`, { width: w, height: 24, ellipsis: true });
      doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(`Variasi: ${it.variant_name || '-'}${it.volume ? ' · ' + it.volume : ''}`, { width: w, height: 20, ellipsis: true });
      if (it.notes) doc.fillColor(C.ink).text(`Catatan: ${it.notes}`, { width: w, height: 10, ellipsis: true });
    });
    cell(cols[3], (cx, cy, w) => doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(it.dimension || '-', cx, cy, { width: w }));
    cell(cols[4], (cx, cy, w) => doc.font('Helvetica-Bold').fontSize(10).text(Number(it.qty).toLocaleString('id-ID'), cx, cy, { width: w }).font('Helvetica').fontSize(7).fillColor(C.muted).text('pcs', { width: w }));
    cell(cols[5], (cx, cy, w) => doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(it.supplier, cx, cy, { width: w }));
    cell(cols[6], (cx, cy, w) => {
      if (it.batch_number || it.exp_code) {
        doc.font('Courier-Bold').fontSize(8.5).fillColor(C.ink).text(`BN : ${it.batch_number || '-'}`, cx, cy, { width: w })
          .text(`EXP: ${it.exp_code || '-'}`, { width: w });
      } else doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text('Belum diisi', cx, cy, { width: w });
    });
    cell(cols[7], (cx, cy, w) => {
      doc.font('Helvetica').fontSize(7.5);
      if (it.generated_uuid) {
        const url = `${baseUrl}/files/${it.generated_uuid}/${encodeURIComponent(it.generated_name)}`;
        doc.fillColor(C.accent).font('Helvetica-Bold').text('File siap cetak (batch baru)', cx, cy, { width: w, link: url, underline: true });
        doc.font('Helvetica').fontSize(6.5).fillColor(C.muted).text(url, { width: w, link: url, height: 18, ellipsis: true });
      }
      if (it.drive_link) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.link).text('File mentah (Google Drive)', it.generated_uuid ? cx : cx, it.generated_uuid ? doc.y + 2 : cy, { width: w, link: it.drive_link, underline: true });
        doc.font('Helvetica').fontSize(6.5).fillColor(C.muted).text(it.drive_link, { width: w, link: it.drive_link, height: 18, ellipsis: true });
      }
    });
    doc.moveTo(left, y + rowH).lineTo(left + W, y + rowH).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.y = y + rowH;
  });

  // supplier totals
  const bySup = {};
  for (const it of list) bySup[it.supplier] = (bySup[it.supplier] || 0) + Number(it.qty);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text('Rekap per supplier: ', left, doc.y, { continued: true })
    .font('Helvetica').text(Object.entries(bySup).map(([s, q]) => `${s} (${q.toLocaleString('id-ID')} pcs)`).join('   ·   '));

  // approvals
  const boxH = 120;
  if (doc.y + boxH + 40 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.head).text('PERSETUJUAN (wajib ACC & TTD sebelum diteruskan ke vendor)', left, doc.y);
  const by = doc.y + 6;
  const bw = (W - 10 * (APPROVER_ROLES.length - 1)) / APPROVER_ROLES.length;
  APPROVER_ROLES.forEach((role, i) => {
    const a = approvals.find(x => x.role === role);
    const bx = left + i * (bw + 10);
    doc.roundedRect(bx, by, bw, boxH, 4).lineWidth(0.8).strokeColor(C.line).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.muted).text(ROLE_LABEL[role].toUpperCase(), bx + 10, by + 8, { width: bw - 20 });
    if (a && a.decision === 'approved') {
      const sig = dataUrlToBuffer(a.signature);
      if (sig) { try { doc.image(sig, bx + 10, by + 22, { fit: [bw - 20, 56], align: 'center', valign: 'center' }); } catch {} }
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.accent).text('DISETUJUI', bx + bw - 70, by + 8, { width: 60, align: 'right' });
    } else if (a && a.decision === 'rejected') {
      doc.font('Helvetica-Bold').fontSize(14).fillColor(C.red).text('DITOLAK', bx + 10, by + 42, { width: bw - 20, align: 'center' });
    } else {
      doc.font('Helvetica').fontSize(8).fillColor(C.muted).text('(belum ditandatangani)', bx + 10, by + 45, { width: bw - 20, align: 'center' });
    }
    doc.moveTo(bx + 10, by + 84).lineTo(bx + bw - 10, by + 84).lineWidth(0.5).strokeColor(C.ink).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(a ? a.user_name : 'Nama: ....................', bx + 10, by + 88, { width: bw - 20, align: 'center' });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(a ? `${fmtDate(a.signed_at, true)}${a.note ? ' · ' + a.note : ''}` : 'Tanggal: ....................', bx + 10, by + 101, { width: bw - 20, align: 'center', height: 16, ellipsis: true });
  });
  doc.y = by + boxH + 8;
  doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(`Dokumen dibuat otomatis oleh Sistem Request Cetak Sticker · ${baseUrl}`, left, doc.y, { width: W, align: 'center' });
  doc.end();
}

/** Recap of many requests (admin report). */
async function recapPdf(stream, { requests, from, to, status, baseUrl }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, info: { Title: 'Laporan Request Cetak Sticker' } });
  doc.pipe(stream);
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;
  header(doc, 'LAPORAN REQUEST CETAK STICKER',
    `Periode ${from ? fmtDate(from) : 'awal'} s/d ${to ? fmtDate(to) : 'sekarang'}${status ? ' · Status: ' + (STATUS_LABEL[status] || status) : ''} · ${requests.length} request · Dicetak ${fmtDate(new Date().toISOString(), true)}`);
  const cols = [
    { t: 'No. Request', w: 92 }, { t: 'Tgl', w: 62 }, { t: 'Pemohon', w: 90 }, { t: 'Produk / Variasi', w: 230 },
    { t: 'Ukuran', w: 62 }, { t: 'Qty', w: 50 }, { t: 'Supplier', w: 80 }, { t: 'Batch / Exp', w: 70 }, { t: 'Status', w: W - 736 },
  ];
  const drawHead = () => {
    const y = doc.y; doc.rect(left, y, W, 16).fill(C.head);
    let x = left; doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff');
    for (const c of cols) { doc.text(c.t, x + 3, y + 4.5, { width: c.w - 6 }); x += c.w; }
    doc.y = y + 16;
  };
  drawHead();
  let n = 0, total = 0;
  for (const r of requests) {
    for (const it of r.items) {
      const h = 26;
      if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHead(); }
      const y = doc.y;
      if (n++ % 2) doc.rect(left, y, W, h).fill(C.soft);
      const vals = [r.number, fmtDate(r.request_date), r.requester_name,
        `${it.brand} · ${it.product_code ? it.product_code + '. ' : ''}${it.product_name} — ${it.variant_name || ''} [${PACKAGE_LABEL[it.package_type] || 'Sticker / Label'}]`,
        it.dimension || '-', Number(it.qty).toLocaleString('id-ID'), it.supplier,
        it.batch_number || it.exp_code ? `${it.batch_number || '-'} / ${it.exp_code || '-'}` : '-', STATUS_LABEL[r.status] || r.status];
      let x = left;
      vals.forEach((v, k) => {
        doc.font(k === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(C.ink)
          .text(String(v), x + 3, y + 4, { width: cols[k].w - 6, height: h - 6, ellipsis: true, link: k === 3 && it.drive_link ? it.drive_link : undefined });
        x += cols[k].w;
      });
      total += Number(it.qty);
      doc.y = y + h;
    }
  }
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(`Total: ${n} item · ${total.toLocaleString('id-ID')} pcs`, left, doc.y);
  doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(`Sistem Request Cetak Sticker · ${baseUrl}`, left, doc.y + 6, { width: W, align: 'center' });
  doc.end();
}

module.exports = { requestPdf, recapPdf, STATUS_LABEL, ROLE_LABEL, APPROVER_ROLES };
