const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stiker-test-'));
const app = require('../server');

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let server, base;
test.before(() => new Promise(r => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
test.after(() => server.close());

async function login(username, password = 'ganti123') {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.strictEqual(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (p, body, method) => {
    const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : await r.arrayBuffer() };
  };
}

test('catalog is seeded from the Drive snapshot and searchable', async () => {
  const u = await login('user');
  const brands = (await u('/api/brands')).data;
  assert.ok(brands.some(b => b.name === 'Maskit'));
  const prods = (await u('/api/products?q=M141')).data;
  assert.strictEqual(prods[0].code, 'M141');
  const p = (await u('/api/products/' + prods[0].id)).data;
  assert.strictEqual(p.variants[0].dimension, '8,5 x 7 cm');
});

test('request → Desainer + Purchasing sign → sent to vendor', async () => {
  const u = await login('user');
  const v = (await u('/api/products/' + (await u('/api/products?q=M141')).data[0].id)).data.variants[0];
  const bad = await u('/api/requests', { items: [{ variant_id: v.id, qty: 10, supplier: 'Tidak Ada' }] });
  assert.strictEqual(bad.status, 400);
  const created = await u('/api/requests', { request_date: '2026-11-23', items: [{ variant_id: v.id, qty: 1000, supplier: 'Lainnya', supplier_other: 'Vendor X' }] });
  assert.strictEqual(created.status, 200);
  const r = created.data;
  assert.match(r.number, /^REQ-202611-\d{4}$/);
  assert.strictEqual(r.items[0].supplier, 'Lainnya: Vendor X');

  const admin = await login('admin', 'admin123');
  assert.strictEqual((await admin(`/api/requests/${r.id}/status`, { status: 'sent' })).status, 400, 'cannot send before approvals');
  assert.strictEqual((await u(`/api/requests/${r.id}/approve`, { decision: 'approved', signature: SIG })).status, 403, 'user cannot approve');

  const des = await login('desainer');
  assert.strictEqual((await des(`/api/requests/${r.id}/approve`, { decision: 'approved' })).status, 400, 'signature required');
  assert.strictEqual((await des(`/api/requests/${r.id}/approve`, { decision: 'approved', signature: SIG })).data.status, 'pending');
  const mgr = await login('manager');
  assert.strictEqual((await mgr(`/api/requests/${r.id}/approve`, { decision: 'approved', signature: SIG })).status, 403, 'manager no longer approves');
  assert.strictEqual((await mgr(`/api/requests/${r.id}`)).status, 200, 'manager can still view');
  const pur = await login('purchasing');
  assert.strictEqual((await pur(`/api/requests/${r.id}/approve`, { decision: 'approved', signature: SIG })).data.status, 'approved');
  const sent = await admin(`/api/requests/${r.id}/status`, { status: 'sent', note: 'via WA' });
  assert.strictEqual(sent.data.status, 'sent');

  const pdf = await admin(`/api/requests/${r.id}/pdf`);
  assert.strictEqual(Buffer.from(pdf.data).slice(0, 5).toString(), '%PDF-');
  const recap = await admin('/api/reports/pdf?from=2026-11-01&to=2026-11-30');
  assert.strictEqual(Buffer.from(recap.data).slice(0, 5).toString(), '%PDF-');
});

test('a rejection blocks the request', async () => {
  const u = await login('user');
  const v = (await u('/api/products/' + (await u('/api/products?q=M141')).data[0].id)).data.variants[0];
  const r = (await u('/api/requests', { items: [{ variant_id: v.id, qty: 5, supplier: 'Kame' }] })).data;
  const d = await login('desainer');
  assert.strictEqual((await d(`/api/requests/${r.id}/approve`, { decision: 'rejected' })).status, 400, 'reason required');
  assert.strictEqual((await d(`/api/requests/${r.id}/approve`, { decision: 'rejected', note: 'Ukuran salah' })).data.status, 'rejected');
});

test('admin adds a new product that users can immediately pick', async () => {
  const admin = await login('admin', 'admin123');
  const brand = (await admin('/api/brands', { name: 'Brand Baru Test' })).data;
  const bad = await admin('/api/products', { brand_id: brand.id, name: 'Tanpa file', variants: [{ drive_link: 'https://drive.google.com/drive/folders/abc' }] });
  assert.strictEqual(bad.status, 400);
  const p = await admin('/api/products', {
    brand_id: brand.id, code: 'X001', name: 'Produk Test', description: 'detail',
    variants: [{ drive_link: 'https://drive.google.com/file/d/1TESTFILEidAbCdEfGhIjKlMn/view?usp=sharing', name: 'Label 100mL 11 x 8,5 cm' }],
  });
  assert.strictEqual(p.status, 200);
  const u = await login('user');
  const found = (await u('/api/products?q=X001')).data;
  assert.strictEqual(found[0].name, 'Produk Test');
  const detail = (await u('/api/products/' + found[0].id)).data;
  assert.strictEqual(detail.variants[0].dimension, '11 x 8,5 cm');
  assert.strictEqual(detail.variants[0].volume, '100 mL');
  assert.strictEqual(detail.variants[0].drive_file_id, '1TESTFILEidAbCdEfGhIjKlMn');
});

test('user can request a product / brand that is not in the catalog', async () => {
  const u = await login('user');
  const bad = await u('/api/requests', { items: [{ manual: true, manual_confirmed: true, brand: '', product_name: 'X', qty: 10, supplier: 'Kame' }] });
  assert.strictEqual(bad.status, 400);
  const noConfirm = await u('/api/requests', { items: [{ manual: true, brand: 'B', product_name: 'P', qty: 1, supplier: 'Kame' }] });
  assert.strictEqual(noConfirm.status, 400, 'manual input must be confirmed as not in catalog');
  const r = (await u('/api/requests', { division: 'Tim Gudang', items: [{
    manual: true, manual_confirmed: true, brand: 'Brand Baru', product_name: 'Sabun Cair Lemon 1L', package_type: 'flexible', dimension: '15 x 20 cm',
    variant_name: '1 Liter', qty: 300, supplier: 'Jawara Pouch', drive_link: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view',
  }] })).data;
  assert.strictEqual(r.division, 'Tim Gudang');
  const it = r.items[0];
  assert.strictEqual(it.is_manual, 1);
  assert.strictEqual(it.variant_id, null);
  assert.strictEqual(it.brand, 'Brand Baru');
  assert.strictEqual(it.product_name, 'Sabun Cair Lemon 1L');
  assert.strictEqual(it.package_type, 'flexible');
  assert.strictEqual(it.drive_file_id, '1AbCdEfGhIjKlMnOpQrStUvWx');
  // admin can record batch/exp text for manual items
  const admin = await login('admin', 'admin123');
  assert.strictEqual((await admin('/api/request-items/' + it.id, { batch_number: '112611Z01', exp_code: '11-2029' }, 'PUT')).status, 200);
  for (const who of ['desainer', 'purchasing']) await (await login(who))(`/api/requests/${r.id}/approve`, { decision: 'approved', signature: SIG });
  assert.strictEqual((await admin(`/api/requests/${r.id}`)).data.status, 'approved');
  const pr = (await admin(`/api/requests/${r.id}/purchase-requests`, { supplier: 'Jawara Pouch' })).data;
  const pdf = await admin(pr.pdf_url);
  assert.strictEqual(Buffer.from(pdf.data).slice(0, 5).toString(), '%PDF-');
  const me = (await u('/api/me')).data;
  assert.ok(me.divisions.includes('Tim Packing') && me.divisions.includes('Tim Gudang'));
});

test('shared history: every user sees all team orders, progress, and double-order warnings', async () => {
  const admin = await login('admin', 'admin123');
  // a second plain user from another team
  await admin('/api/users', { username: 'gudang1', name: 'Rina Gudang', role: 'user', division: 'Tim Gudang', password: 'gudang123' });
  const packing = await login('user');
  const gudang = await login('gudang1', 'gudang123');
  const v = (await packing('/api/products/' + (await packing('/api/products?q=M141')).data[0].id)).data.variants[0];
  const r = (await packing('/api/requests', { division: 'Tim Packing', items: [{ variant_id: v.id, qty: 1500, supplier: 'PWD' }] })).data;

  // other team can see it in the list, the detail and the item history
  assert.ok((await gudang('/api/requests')).data.some(x => x.id === r.id));
  assert.strictEqual((await gudang(`/api/requests/${r.id}`)).status, 200);
  assert.ok((await gudang('/api/history?q=M141')).data.some(h => h.request_id === r.id && h.division === 'Tim Packing'));
  assert.strictEqual((await gudang(`/api/requests/${r.id}/cancel`, {})).status, 403, 'cannot cancel others');

  // double-order check + last order info on the variant
  const dup = (await gudang('/api/requests/check-duplicates', { items: [{ variant_id: v.id }, { manual: true, brand: 'Tidak Ada', product_name: 'Produk Lain' }] })).data;
  assert.ok(dup.results[0].matches.some(m => m.request_id === r.id));
  assert.strictEqual(dup.results[1].matches.length, 0);
  const pv = (await gudang('/api/products/' + (await gudang('/api/products?q=M141')).data[0].id)).data.variants[0];
  assert.ok(pv.last_order && pv.last_order.qty > 0);

  // progress: ACC Desainer + Purchasing → Naik Cetak → Terkirim (purchasing)
  for (const who of ['desainer', 'purchasing']) await (await login(who))(`/api/requests/${r.id}/approve`, { decision: 'approved', signature: SIG });
  assert.strictEqual((await gudang(`/api/requests/${r.id}/status`, { status: 'sent' })).status, 403, 'users cannot change progress');
  const pur = await login('purchasing');
  const printed = (await pur(`/api/requests/${r.id}/status`, { status: 'sent', date: '2026-11-24' })).data;
  assert.strictEqual(printed.status, 'sent');
  assert.strictEqual(printed.printed_at, '2026-11-24');
  const delivered = (await pur(`/api/requests/${r.id}/status`, { status: 'done', date: '2026-11-27', note: 'Diterima Tim Gudang' })).data;
  assert.strictEqual(delivered.status, 'done');
  assert.strictEqual(delivered.delivered_at, '2026-11-27');
  assert.strictEqual(delivered.delivered_by, 'Purchasing');
  assert.strictEqual(delivered.delivered_note, 'Diterima Tim Gudang');
  const seen = (await gudang('/api/requests')).data.find(x => x.id === r.id);
  assert.strictEqual(seen.status, 'done');
});
