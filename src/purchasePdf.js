// Formal Purchase Request (to vendor) on PT SAINSGO KARYA INDONESIA letterhead.
const PDFDocument = require('pdfkit');
const { getThumbnail, imageKind } = require('./thumbs');

const PACKAGE_LABEL = { sticker: 'Sticker / Label', flexible: 'Flexible Packaging', box: 'Box / Karton', other: 'Lainnya' };
const C = { ink: '#111111', muted: '#555555', line: '#9a9a9a', head: '#e6f6f5', brand: '#168898', link: '#1a4fb5' };
const TERMS = [
  'Barang dicetak sesuai file cetak terlampir (link file siap cetak) beserta ukuran, bahan, dan jumlah pada tabel di atas.',
  'Vendor wajib mengirimkan proof/sampel cetak untuk disetujui sebelum produksi massal.',
  'Nomor batch dan tanggal kedaluwarsa harus sesuai file cetak. Kesalahan cetak menjadi tanggung jawab vendor.',
  'Mohon cantumkan nomor Purchase Request ini pada surat jalan dan invoice.',
];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function tanggal(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function dataUrlToBuffer(u) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(u || '');
  return m ? Buffer.from(m[2], 'base64') : null;
}

function letterhead(doc, company) {
  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
  const top = 30;
  const logo = dataUrlToBuffer(company.company_logo);
  let textX = L, textW = W, align = 'center', logoH = 0;
  if (logo) {
    try {
      doc.image(logo, L, top, { fit: [64, 76], align: 'center', valign: 'center' });
      textX = L + 80; textW = W - 80; align = 'left'; logoH = 76;
    } catch {}
  }
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(18).text(company.company_name || 'PT SAINSGO KARYA INDONESIA', textX, top + (logoH ? 14 : 2), { width: textW, align, characterSpacing: 0.6 });
  doc.font('Helvetica').fontSize(9).fillColor('#333');
  if (company.company_address) doc.text(company.company_address.replace(/\s*\n\s*/g, ', '), textX, doc.y + 2, { width: textW, align });
  if (company.company_email) doc.text(`Email: ${company.company_email}`, { width: textW, align });
  const y = Math.max(doc.y + 6, top + logoH + 4);
  doc.moveTo(L, y).lineTo(L + W, y).lineWidth(2.2).strokeColor(C.brand).stroke();
  doc.moveTo(L, y + 3.5).lineTo(L + W, y + 3.5).lineWidth(0.7).stroke();
  doc.y = y + 14;
}

function footer(doc, company, pr) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
    const y = doc.page.height - 30;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(L, y - 6).lineTo(L + W, y - 6).lineWidth(0.4).strokeColor(C.line).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(C.muted)
      .text(`${company.company_name || 'PT SAINSGO KARYA INDONESIA'}  ·  ${pr.number}`, L, y, { width: W / 2, lineBreak: false })
      .text(`Halaman ${i - range.start + 1} dari ${range.count}`, L + W / 2, y, { width: W / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

async function purchasePdf(stream, { pr, request, company, baseUrl, creatorSignature, creatorRole = 'Admin' }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 30, left: 46, right: 46, bottom: 52 }, bufferPages: true,
    info: { Title: `Purchase Request ${pr.number}`, Author: company.company_name } });
  doc.pipe(stream);
  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;
  const items = pr.items;
  // Short, complete URL (nama file tetap terbawa saat diunduh) — mudah disalin vendor.
  const fileUrl = it => it.final_link || (it.generated_uuid ? `${baseUrl}/files/${it.generated_uuid}` : '');

  letterhead(doc, company);

  // Title
  doc.font('Helvetica-Bold').fontSize(14).fillColor(C.ink).text('PURCHASE REQUEST', L, doc.y, { width: W, align: 'center', characterSpacing: 1.2 });
  const tw = doc.widthOfString('PURCHASE REQUEST', { characterSpacing: 1.2 });
  doc.moveTo(L + (W - tw) / 2, doc.y).lineTo(L + (W + tw) / 2, doc.y).lineWidth(0.8).strokeColor(C.ink).stroke();
  doc.font('Helvetica').fontSize(9.5).text(`Nomor: ${pr.number}`, L, doc.y + 3, { width: W, align: 'center' });
  doc.moveDown(1);

  // Addressee + info
  const y0 = doc.y;
  const colL = W * 0.52;
  doc.font('Helvetica').fontSize(9).fillColor(C.ink).text('Kepada Yth.', L, y0);
  doc.font('Helvetica-Bold').fontSize(10.5).text(pr.vendor_name, { width: colL - 10 });
  doc.font('Helvetica').fontSize(9);
  if (pr.vendor_contact) doc.text(`Up. ${pr.vendor_contact}`, { width: colL - 10 });
  if (pr.vendor_address) doc.text(pr.vendor_address, { width: colL - 10 });
  const vc = [pr.vendor_phone && `Telp. ${pr.vendor_phone}`, pr.vendor_email].filter(Boolean).join('  ·  ');
  if (vc) doc.text(vc, { width: colL - 10 });
  doc.text('di Tempat', { width: colL - 10 });
  const yLeftEnd = doc.y;
  const info = [
    ['Tanggal', tanggal(pr.pr_date)],
    ['Ref. Request Internal', request.number],
    ['Pemohon', `${request.requester_name}${request.division ? ' (' + request.division + ')' : ''}`],
    ['Tanggal Dibutuhkan', pr.delivery_date ? tanggal(pr.delivery_date) : '-'],
  ];
  let iy = y0;
  const ix = L + colL, iw = W - colL;
  for (const [k, v] of info) {
    doc.font('Helvetica').fontSize(8.8).fillColor(C.muted).text(k, ix, iy, { width: 100 });
    doc.fillColor(C.ink).text(':', ix + 100, iy);
    doc.font('Helvetica-Bold').text(v, ix + 108, iy, { width: iw - 108 });
    iy = doc.y + 2;
  }
  doc.y = Math.max(yLeftEnd, iy) + 10;

  doc.font('Helvetica').fontSize(9.5).fillColor(C.ink).text('Dengan hormat,', L, doc.y, { width: W });
  doc.moveDown(0.3).text('Bersama ini kami mengajukan permintaan pencetakan kemasan dengan rincian sebagai berikut:', { width: W, align: 'justify' });
  doc.moveDown(0.6);

  // Items table (tanpa harga)
  const cols = [{ t: 'No', w: 24, a: 'center' }, { t: 'Deskripsi Barang', w: 233 }, { t: 'Jenis Kemasan', w: 80 },
    { t: 'Ukuran', w: 76, a: 'center' }, { t: 'Jumlah', w: W - 413, a: 'right' }];
  const drawHead = () => {
    const y = doc.y;
    const hh = 22;
    doc.rect(L, y, W, hh).fillAndStroke(C.head, C.ink);
    let x = L;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink);
    for (const c of cols) {
      doc.text(c.t, x + 4, y + 7, { width: c.w - 8, align: c.a || 'left' });
      doc.moveTo(x, y).lineTo(x, y + hh).lineWidth(0.6).strokeColor(C.ink).stroke();
      x += c.w;
    }
    doc.moveTo(L + W, y).lineTo(L + W, y + hh).stroke();
    doc.y = y + hh;
  };
  drawHead();
  items.forEach((it, i) => {
    const desc = [
      { f: 'Helvetica-Bold', s: 8.8, t: `${it.product_code ? it.product_code + ' - ' : ''}${it.product_name}` },
      { f: 'Helvetica', s: 8, t: `Brand: ${it.brand}${it.volume ? ' · ' + it.volume : ''}` },
      { f: 'Helvetica', s: 8, t: `Desain: ${it.variant_name}` },
      ...(it.batch_number || it.exp_code ? [{ f: 'Courier-Bold', s: 8, t: `BN ${it.batch_number || '-'}  EXP ${it.exp_code || '-'}` }] : []),
      ...(it.spec ? [{ f: 'Helvetica-Oblique', s: 8, t: `Spesifikasi: ${it.spec}` }] : []),
    ];
    const dw = cols[1].w - 10;
    let h = 5;
    for (const d of desc) h += doc.font(d.f).fontSize(d.s).heightOfString(d.t, { width: dw });
    h = Math.max(h + 6, 30);
    if (doc.y + h > bottomLimit() - 10) { doc.addPage(); drawHead(); }
    const y = doc.y;
    let x = L;
    const cells = [
      () => doc.font('Helvetica').fontSize(9).text(String(i + 1), x + 4, y + 6, { width: cols[0].w - 8, align: 'center' }),
      () => { doc.y = y + 5; for (const d of desc) doc.font(d.f).fontSize(d.s).fillColor(C.ink).text(d.t, x + 5, doc.y, { width: dw }); },
      () => doc.font('Helvetica').fontSize(8.5).text(PACKAGE_LABEL[it.package_type] || 'Sticker / Label', x + 4, y + 6, { width: cols[2].w - 8 }),
      () => doc.font('Helvetica').fontSize(8.5).text(it.dimension || '-', x + 4, y + 6, { width: cols[3].w - 8, align: 'center' }),
      () => doc.font('Helvetica-Bold').fontSize(9).text(`${Number(it.qty).toLocaleString('id-ID')} ${it.unit || 'pcs'}`, x + 4, y + 6, { width: cols[4].w - 8, align: 'right' }),
    ];
    cells.forEach((draw, k) => {
      doc.fillColor(C.ink); draw();
      doc.moveTo(x, y).lineTo(x, y + h).lineWidth(0.6).strokeColor(C.ink).stroke();
      x += cols[k].w;
    });
    doc.moveTo(L + W, y).lineTo(L + W, y + h).stroke();
    doc.moveTo(L, y + h).lineTo(L + W, y + h).stroke();
    doc.y = y + h;
  });
  // total quantity
  {
    const totalQty = items.reduce((a, b) => a + Number(b.qty), 0);
    if (doc.y + 30 > bottomLimit()) doc.addPage();
    const y = doc.y, lw = W - cols[cols.length - 1].w;
    doc.rect(L, y, W, 18).lineWidth(0.6).strokeColor(C.ink).stroke();
    doc.moveTo(L + lw, y).lineTo(L + lw, y + 18).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
      .text(`Total (${items.length} item)`, L + 4, y + 5, { width: lw - 8, align: 'right' })
      .text(`${totalQty.toLocaleString('id-ID')} pcs`, L + lw + 4, y + 5, { width: cols[cols.length - 1].w - 8, align: 'right' });
    doc.y = y + 18;
  }
  doc.moveDown(0.9);

  // Delivery, files, notes
  const block = (title, body) => {
    if (doc.y + 40 > bottomLimit()) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.ink).text(title, L, doc.y, { width: W });
    doc.moveDown(0.2);
    body();
    doc.moveDown(0.5);
  };
  block('Pengiriman', () => {
    doc.font('Helvetica').fontSize(8.8).text(`Alamat kirim: ${pr.delivery_address || '-'}`, L, doc.y, { width: W });
  });
  block('File Cetak', () => {
    items.forEach((it, i) => {
      if (doc.y + 26 > bottomLimit()) doc.addPage();
      doc.font('Helvetica').fontSize(8.5).fillColor(C.ink).text(`${i + 1}. ${it.product_code ? it.product_code + ' - ' : ''}${it.product_name} (${it.dimension || '-'})`, L, doc.y, { width: W });
      // Vendor hanya menerima FILE JADI (sudah berisi nomor batch & expired) — tidak ada file mentah/master.
      if (it.batch_number || it.exp_code) {
        doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(`BN ${it.batch_number || '-'}   ·   EXP ${it.exp_code || '-'}`, L + 14, doc.y, { width: W - 14 });
      }
      if (it.vendor_note) {
        doc.font('Helvetica-Bold').fontSize(8.3).fillColor(C.ink).text('Catatan desain: ', L + 14, doc.y, { width: W - 14, continued: true })
          .font('Helvetica').text(it.vendor_note);
      }
      const u = fileUrl(it);
      if (u) {
        doc.font('Helvetica-Bold').fontSize(8.3).fillColor(C.ink).text('File siap cetak:', L + 14, doc.y, { width: W - 14 });
        // URL ditulis utuh (dibungkus ke baris berikutnya bila panjang) agar mudah disalin.
        doc.font('Courier').fontSize(8).fillColor(C.link).text(u, L + 14, doc.y, { width: W - 14, link: u, underline: true, lineBreak: true });
      } else {
        doc.font('Helvetica-Oblique').fontSize(8.3).fillColor(C.muted).text('File cetak menyusul — akan dikirim setelah desainer menyiapkan file jadi.', L + 14, doc.y, { width: W - 14 });
      }
      doc.moveDown(0.25);
    });
    doc.fillColor(C.ink);
  });
  block('Ketentuan', () => {
    TERMS.forEach((t, i) => doc.font('Helvetica').fontSize(8.6).fillColor(C.ink).text(`${i + 1}.  ${t}`, L, doc.y, { width: W, align: 'justify' }));
    if (pr.notes) doc.font('Helvetica-Bold').fontSize(8.6).text('Catatan: ', L, doc.y, { continued: true }).font('Helvetica').text(pr.notes, { width: W });
  });

  // Closing + signatures are kept together on one page.
  const boxH = 98;
  if (doc.y + 30 + 14 + boxH > bottomLimit()) doc.addPage();
  doc.font('Helvetica').fontSize(9.5).fillColor(C.ink).text('Demikian permintaan ini kami sampaikan. Atas perhatian dan kerja samanya kami ucapkan terima kasih.', L, doc.y, { width: W, align: 'justify' });
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(9.5).text(`${company.pr_city || 'Depok'}, ${tanggal(pr.pr_date)}`, L, doc.y, { width: W, align: 'right' });
  doc.moveDown(0.3);
  const ap = role => (request.approvals || []).find(a => a.role === role && a.decision === 'approved');
  const sigs = [
    { h: 'Dibuat oleh,', role: creatorRole, name: pr.created_by_name, sig: creatorSignature },
    { h: 'Diperiksa oleh,', role: 'Desainer', name: ap('desainer')?.user_name, sig: ap('desainer')?.signature },
    { h: 'Disetujui oleh,', role: 'Purchasing', name: ap('purchasing')?.user_name, sig: ap('purchasing')?.signature },
    { h: 'Konfirmasi Vendor,', role: pr.vendor_name, name: '', sig: null },
  ];
  const sy = doc.y, sw = W / sigs.length;
  sigs.forEach((s, i) => {
    const x = L + i * sw;
    doc.font('Helvetica').fontSize(9).fillColor(C.ink).text(s.h, x, sy, { width: sw - 8, align: 'center' });
    const img = dataUrlToBuffer(s.sig);
    if (img) { try { doc.image(img, x + 14, sy + 13, { fit: [sw - 36, 44], align: 'center', valign: 'center' }); } catch {} }
    doc.moveTo(x + 12, sy + 64).lineTo(x + sw - 20, sy + 64).lineWidth(0.6).strokeColor(C.ink).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(s.name || ' ', x, sy + 68, { width: sw - 8, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(s.role, x, sy + 80, { width: sw - 8, align: 'center', height: 12, ellipsis: true });
  });
  doc.y = sy + boxH;

  // Lampiran: visual desain
  const thumbs = new Map();
  await Promise.all(items.map(async it => {
    if (!it.drive_file_id) return;
    const buf = await getThumbnail(it.drive_file_id, 500).catch(() => null);
    if (buf && imageKind(buf)) thumbs.set(it.id, buf);
  }));
  if (thumbs.size) {
    doc.addPage();
    letterhead(doc, company);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(`LAMPIRAN — Visual Desain (${pr.number})`, L, doc.y, { width: W });
    doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text('Gambar hanya sebagai acuan visual. Gunakan file siap cetak pada tautan di halaman sebelumnya untuk produksi.', { width: W });
    doc.moveDown(0.6);
    const cw = (W - 14) / 2, ch = 206;
    let col = 0, rowY = doc.y;
    items.forEach((it, i) => {
      if (col === 0 && rowY + ch > bottomLimit()) { doc.addPage(); rowY = doc.page.margins.top + 10; }
      const x = L + col * (cw + 14);
      doc.rect(x, rowY, cw, ch).lineWidth(0.5).strokeColor(C.line).stroke();
      const buf = thumbs.get(it.id);
      if (buf) { try { doc.image(buf, x + 8, rowY + 8, { fit: [cw - 16, 140], align: 'center', valign: 'center' }); } catch {} }
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(`${i + 1}. ${it.product_code ? it.product_code + ' - ' : ''}${it.product_name}`, x + 8, rowY + 154, { width: cw - 16, height: 22, ellipsis: true });
      doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(`${PACKAGE_LABEL[it.package_type] || 'Sticker / Label'} · ${it.dimension || '-'} · ${Number(it.qty).toLocaleString('id-ID')} ${it.unit || 'pcs'}`, x + 8, rowY + 180, { width: cw - 16 });
      col = (col + 1) % 2;
      if (col === 0) rowY += ch + 12;
    });
  }

  footer(doc, company, pr);
  doc.end();
}

module.exports = { purchasePdf, PACKAGE_LABEL };
