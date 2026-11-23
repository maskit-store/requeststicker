const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stiker-pr-test-'));
const app = require('../server');
const { classifyPackaging } = require('../src/catalogParser');

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let server, base;
test.before(() => new Promise(r => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
test.after(() => server.close());

async function login(username, password = 'ganti123') {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (p, body, method) => {
    const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}

test('packaging type is recognised from the file / folder names', () => {
  const cases = [
    ['M141. Perfumed shampoo - baccarat - 8,5 x 7 cm.pdf', [], 'sticker'],
    ["D001. Dotty's Lab - ROBOT VACUUM 250mL - 15x10cm (LABEL).pdf", [], 'sticker'],
    ['M185-10x5cm - Lebel 2liter Baby Softener Maskit', ['Lebel Pouch 2 Liter'], 'sticker'],
    ['I001. Indogredient - Minuman Serbuk 1Kg - 20x30cm (POUCH).pdf', [], 'flexible'],
    ['M227. MASKIT - CALCARE 20g - 9x14cm (SACHET).pdf', [], 'flexible'],
    ['(Layout 10x12cm) - Baby Laundry Detergent 20mL SACHET 12x4cm (Three Side Seal).pdf', [], 'flexible'],
    ['T009. FIX_KEMASAN TWINBI Burnas Bumbu Rasa Sayur Asem.pdf', [], 'flexible'],
    ['T061. Nastan Bumbu Rasa Ayam & Telur Asin - 14x23cm.pdf', [], 'flexible'],
    ['M227. MASKIT - CALCARE 20g - 7,5x4x14cm (BOX).pdf', [], 'box'],
    ['6.2x4.3cm - (Final Rev) Skin Renewal Serum Concentrate.pdf', ['Stiker untuk Box'], 'sticker'],
    ['Brocure Suntikan Cetak.pdf', [], 'other'],
  ];
  for (const [file, sub, want] of cases) assert.strictEqual(classifyPackaging(file, sub), want, file);
});

test('catalog can be filtered by packaging type; admin override survives', async () => {
  const u = await login('user');
  const flex = (await u('/api/products?package_type=flexible&limit=500')).data;
  assert.ok(flex.length > 10);
  assert.ok(flex.every(p => p.package_types.split(',').includes('flexible')));
  const admin = await login('admin', 'admin123');
  const p = (await u('/api/products/' + (await u('/api/products?q=M141')).data[0].id)).data;
  assert.strictEqual(p.variants[0].package_type, 'sticker');
  await admin('/api/variants/' + p.variants[0].id, { package_type: 'flexible' }, 'PUT');
  const p2 = (await u('/api/products/' + p.id)).data;
  assert.strictEqual(p2.variants[0].package_type, 'flexible');
  assert.strictEqual(p2.variants[0].package_type_manual, 1);
  await admin('/api/variants/' + p.variants[0].id, { package_type: 'sticker' }, 'PUT');
});

test('purchase request: only after approval, numbered, formal PDF', async () => {
  const u = await login('user');
  const flexProd = (await u('/api/products?package_type=flexible&q=Nastan')).data[0];
  const fv = (await u('/api/products/' + flexProd.id)).data.variants.find(v => v.package_type === 'flexible');
  const r = (await u('/api/requests', { request_date: '2026-11-23', needed_date: '2026-12-01', items: [
    { variant_id: fv.id, qty: 5000, supplier: 'Juke Sachet & Pouch' },
  ] })).data;
  assert.strictEqual(r.items[0].package_type, 'flexible');

  const admin = await login('admin', 'admin123');
  const early = await admin(`/api/requests/${r.id}/purchase-requests`, { supplier: 'Juke Sachet & Pouch' });
  assert.strictEqual(early.status, 400);
  assert.strictEqual((await u(`/api/requests/${r.id}/purchase-requests`, { supplier: 'Juke Sachet & Pouch' })).status, 403);

  for (const who of ['desainer', 'purchasing']) await (await login(who))(`/api/requests/${r.id}/approve`, { decision: 'approved', signature: SIG });

  const draft = (await admin(`/api/requests/${r.id}/purchase-requests/draft?supplier=${encodeURIComponent('Juke Sachet & Pouch')}`)).data;
  assert.strictEqual(draft.vendor.name, 'Juke Sachet & Pouch');
  assert.strictEqual(draft.delivery_date, '2026-12-01');
  const pr = (await admin(`/api/requests/${r.id}/purchase-requests`, {
    supplier: 'Juke Sachet & Pouch', vendor_contact: 'Ibu Rina', vendor_address: 'Bekasi', pr_date: '2026-11-23',
    items: [{ id: draft.items[0].id, qty: 4500, unit: 'pcs', unit_price: '1250' }],
  })).data;
  assert.strictEqual(pr.number, 'PR/SKI/2026/11/0001');
  assert.strictEqual(pr.items[0].qty, 4500);
  assert.strictEqual(pr.items[0].unit_price, undefined, 'harga tidak disimpan / dicetak');
  assert.strictEqual(draft.delivery_address, 'Jl. Raya Pasir Putih No. 147, Sawangan, Depok');
  const pdf = await admin(pr.pdf_url);
  assert.strictEqual(pdf.status, 200);
  assert.strictEqual(pdf.data.slice(0, 5).toString(), '%PDF-');

  // vendor details are remembered for the next PR
  const again = (await admin(`/api/requests/${r.id}/purchase-requests/draft?supplier=${encodeURIComponent('Juke Sachet & Pouch')}`)).data;
  assert.strictEqual(again.vendor.contact_person, 'Ibu Rina');
  const second = (await (await login('purchasing'))(`/api/requests/${r.id}/purchase-requests`, { supplier: 'Juke Sachet & Pouch', pr_date: '2026-11-24' })).data;
  assert.strictEqual(second.number, 'PR/SKI/2026/11/0002');
  const detail = (await admin(`/api/requests/${r.id}`)).data;
  assert.strictEqual(detail.purchase_requests.length, 2);
});

test('company letterhead settings', async () => {
  const admin = await login('admin', 'admin123');
  const c = (await admin('/api/settings/company')).data;
  assert.strictEqual(c.company_name, 'PT SAINSGO KARYA INDONESIA');
  assert.strictEqual(c.company_email, 'admin@sainsgo.com');
  assert.strictEqual(c.pr_city, 'Depok');
  assert.ok(c.logo_is_default && c.company_logo.startsWith('data:image/png;base64,'), 'logo Sainsgo bawaan');
  const bad = await admin('/api/settings/company', { company_logo: 'data:text/html;base64,AAAA' }, 'PUT');
  assert.strictEqual(bad.status, 400);
  const ok = (await admin('/api/settings/company', { company_address: 'Jakarta', company_logo: SIG }, 'PUT')).data;
  assert.strictEqual(ok.company_address, 'Jakarta');
  assert.strictEqual((await (await login('user'))('/api/settings/company', { company_name: 'X' }, 'PUT')).status, 403);
});
