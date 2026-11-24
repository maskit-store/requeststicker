const test = require('node:test');
const assert = require('node:assert');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { detect, replaceBatchExp, classify } = require('../src/batchReplace');

async function samplePdf({ split = false } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([240, 200]);
  const courier = await doc.embedFont(StandardFonts.CourierBold);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Perfumed Shampoo', { x: 10, y: 170, size: 12, font: helv });
  page.drawText('BN.102603B24', { x: 10, y: 30, size: 8, font: courier, color: rgb(1, 1, 1) });
  if (split) {
    page.drawText('EXP.', { x: 10, y: 20, size: 8, font: courier });
    page.drawText('10-2029', { x: 10 + 4 * 0.6 * 8, y: 20, size: 8, font: courier });
  } else {
    page.drawText('Exp.10-2029', { x: 10, y: 20, size: 8, font: courier });
  }
  return Buffer.from(await doc.save());
}

test('classify recognises the batch / expiry formats used on the stickers', () => {
  assert.deepStrictEqual(classify('BN.102603B24'), { kind: 'batch', prefix: 'BN.', value: '102603B24' });
  assert.deepStrictEqual(classify('BN: 072601D66'), { kind: 'batch', prefix: 'BN: ', value: '072601D66' });
  assert.deepStrictEqual(classify('Exp.10-2029'), { kind: 'exp', prefix: 'Exp.', value: '10-2029' });
  assert.deepStrictEqual(classify('EXP: 07-2029'), { kind: 'exp', prefix: 'EXP: ', value: '07-2029' });
  assert.strictEqual(classify('Perfumed Shampoo'), null);
  assert.strictEqual(classify('Expired'), null);
});

test('detects and replaces batch number and expiry code', async () => {
  const src = await samplePdf();
  const found = await detect(src);
  assert.deepStrictEqual(found.map(f => f.text), ['BN.102603B24', 'Exp.10-2029']);
  const out = await replaceBatchExp(src, { batch: '112611A07', exp: '11-2029' });
  assert.deepStrictEqual(out.verify.map(f => f.text), ['BN.112611A07', 'Exp.11-2029']);
  assert.deepStrictEqual(out.replaced.map(r => r.after), ['BN.112611A07', 'Exp.11-2029']);
  // other text untouched
  const again = await detect(out.pdf);
  assert.strictEqual(again.length, 2);
});

test('handles prefix and value written as separate text objects', async () => {
  const out = await replaceBatchExp(await samplePdf({ split: true }), { batch: '112611A07', exp: '11-2029' });
  assert.deepStrictEqual(out.verify.map(f => f.text), ['BN.112611A07', 'EXP.11-2029']);
});

test('only replaces what was given', async () => {
  const out = await replaceBatchExp(await samplePdf(), { exp: '12-2030' });
  assert.deepStrictEqual(out.verify.map(f => f.text), ['BN.102603B24', 'Exp.12-2030']);
});

test('fails clearly when there is nothing to replace', async () => {
  const doc = await PDFDocument.create();
  doc.addPage().drawText('No batch here');
  await assert.rejects(replaceBatchExp(Buffer.from(await doc.save()), { batch: '1' }), e => e.code === 'NOT_FOUND');
});
