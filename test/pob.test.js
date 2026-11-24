const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stiker-pob-test-'));
process.env.SKU_SHEET_OFFLINE = '1';
const app = require('../server');
const sku = require('../src/sku');
const { replaceBatchExp, verifyPrintQuality } = require('../src/batchReplace');

let server, base;
test.before(() => new Promise(r => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
test.after(() => server.close());
async function login(username, password = 'ganti123') {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (p, body, method) => {
    const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
}

test('batch number and expiry follow POB/KO/PD/001.01', () => {
  assert.strictEqual(sku.buildBatch({ prodDate: '2026-04-15', seq: 2, sku: 'A01' }), '042602A01');
  assert.strictEqual(sku.buildBatch({ prodDate: '2026-11-03', seq: 11, sku: 'B24' }), '112611B24');
  assert.strictEqual(sku.buildExp('2026-11-20', 36), '12-2029');   // +36 months +1 reserve
  assert.strictEqual(sku.buildExp('2026-01-01', 11), '01-2027');
  assert.strictEqual(sku.buildExp('2026-12-31', 24), '01-2029');
  assert.throws(() => sku.buildBatch({ prodDate: '2026-04-01', seq: 1, sku: 'A1' }));
  assert.throws(() => sku.buildExp('2026-04-01', 0));
  assert.strictEqual(sku.intToSku(sku.skuToInt('A99') + 1), 'B01');
  assert.strictEqual(sku.intToSku(sku.skuToInt('E72') + 1), 'E73');
});

test('seeded catalog gets SKU codes from the sheet mapping', async () => {
  const a = await login('admin', 'admin123');
  const p = (await a('/api/products?q=M141')).data[0];
  assert.strictEqual((await a('/api/products/' + p.id)).data.sku_code, 'B24');
});

test('batch plan suggests sequence and builds batch/exp; desainer allowed, user not', async () => {
  const d = await login('desainer');
  const u = await login('user');
  const p = (await d('/api/products?q=M141')).data[0];
  const v = (await d('/api/products/' + p.id)).data.variants[0];
  const plan = (await d(`/api/variants/${v.id}/batch-plan?prod_date=2026-11-20&shelf_months=36`)).data;
  assert.strictEqual(plan.batch, '112601B24');
  assert.strictEqual(plan.exp, '12-2029');
  assert.strictEqual(plan.sku_code, 'B24');
  assert.strictEqual((await d(`/api/variants/${v.id}/batch-plan?prod_date=2026-11-20&shelf_months=36&seq=4`)).data.batch, '112604B24');
  assert.strictEqual((await u(`/api/variants/${v.id}/batch-plan?prod_date=2026-11-20`)).status, 403);
  const manual = await d(`/api/variants/${v.id}/generate`, { mode: 'manual', batch: 'X', exp: 'Y' });
  assert.strictEqual(manual.status, 403);
});

test('new product gets next product code + SKU automatically and is queued for the sheet', async () => {
  const a = await login('admin', 'admin123');
  const brand = (await a('/api/brands')).data.find(b => b.name === 'Maskit');
  const next = (await a('/api/products/next-codes?brand_id=' + brand.id)).data;
  assert.match(next.code, /^M\d{3}$/);
  assert.match(next.sku_code, /^[A-Z]\d{2}$/);
  const r = await a('/api/products', { brand_id: brand.id, name: 'Produk Uji POB', volume: '100 mL',
    variants: [{ drive_link: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view', name: 'Label 100mL - 8 x 5 cm' }] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.code, next.code);
  assert.strictEqual(r.data.sku_code, next.sku_code);
  const s = (await a('/api/settings/sheet')).data;
  assert.deepStrictEqual(s.outbox.map(o => o.action).sort(), ['appendProduct', 'appendSku']);
  assert.strictEqual(s.outbox.find(o => o.action === 'appendProduct').payload.tab, 'Maskit');
  // codes continue after the one just used
  assert.notStrictEqual((await a('/api/products/next-codes?brand_id=' + brand.id)).data.code, next.code);
});

test('print quality guard: images and page boxes stay byte-identical, tampering is rejected', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 150]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMAAAA0aAQHx7vVpAAAAAElFTkSuQmCC', 'base64');
  page.drawImage(await doc.embedPng(png), { x: 10, y: 60, width: 80, height: 80 });
  const courier = await doc.embedFont(StandardFonts.CourierBold);
  page.drawText('BN.102603B24', { x: 10, y: 30, size: 8, font: courier });
  page.drawText('EXP.10-2029', { x: 10, y: 20, size: 8, font: courier });
  const src = Buffer.from(await doc.save());
  const out = await replaceBatchExp(src, { batch: '112601B24', exp: '12-2029' });
  assert.strictEqual(out.quality.identical, true);
  assert.strictEqual(out.quality.images, 1);
  // a downscaled copy must be detected
  const bad = await PDFDocument.load(out.pdf);
  bad.getPages()[0].setMediaBox(0, 0, 100, 75);
  await assert.rejects(verifyPrintQuality(src, Buffer.from(await bad.save())), e => e.code === 'QUALITY');
});
