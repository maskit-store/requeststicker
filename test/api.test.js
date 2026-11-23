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

test('request → 3 approvals with signature → sent to vendor', async () => {
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

  for (const who of ['desainer', 'manager']) {
    const c = await login(who);
    assert.strictEqual((await c(`/api/requests/${r.id}/approve`, { decision: 'approved' })).status, 400, 'signature required');
    const res = await c(`/api/requests/${r.id}/approve`, { decision: 'approved', signature: SIG });
    assert.strictEqual(res.data.status, 'pending');
  }
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
