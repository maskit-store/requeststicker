// Turns a crawled Drive tree into a catalog of brands -> products -> variants.
// Conventions observed in the sticker database:
//   ROOT / "! <Brand>" / "<CODE>. <Product name>" / [subfolders] / "<file name with WxH cm>.pdf"
// Folders not prefixed with "!" (e.g. "1. Vendor - ...") are vendor archives and are skipped.

const FILE_EXT_RE = /\.(pdf|ai|png|jpe?g|webp|svg|psd|cdr|eps|tiff?)$/i;
const CODE_RE = /^\s*([A-Z]{1,3}\d{2,4})\s*[.\-\s]/;
// e.g. "8,5 x 7 cm", "10x17cm", "3×7,7 cm", "5,7 x 5,7x 4,4 cm", "⌀5cm"
const DIM_RE = /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[x×X]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×X]\s*(\d+(?:[.,]\d+)?))?\s*(cm|mm)?/;
const DIAMETER_RE = /[⌀Ø]\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)?/;
const VOLUME_RE = /(\d+(?:[.,]\d+)?)\s*(ml|mL|ML|l|L|liter|Liter|gr|g|G|kg|Kg|KG)\b/;
const TYPE_RE = /\((LABEL|BOX|POUCH|SACHET|STIKER|STICKER)\)/i;

function stripExt(name) { return name.replace(FILE_EXT_RE, '').trim(); }

function parseDimension(name) {
  const m = name.match(DIM_RE);
  if (m) {
    const unit = (m[4] || 'cm').toLowerCase();
    const parts = [m[1], m[2], m[3]].filter(Boolean).map(s => s.replace('.', ','));
    return parts.join(' x ') + ' ' + unit;
  }
  const d = name.match(DIAMETER_RE);
  if (d) return '⌀ ' + d[1].replace('.', ',') + ' ' + (d[2] || 'cm').toLowerCase();
  return '';
}

function parseVolume(name) {
  const m = name.match(VOLUME_RE);
  if (!m) return '';
  let unit = m[2];
  const u = unit.toLowerCase();
  if (u === 'ml') unit = 'mL';
  else if (u === 'l' || u === 'liter') unit = 'L';
  else if (u === 'gr' || u === 'g') unit = 'g';
  else if (u === 'kg') unit = 'Kg';
  return m[1] + ' ' + unit;
}

function parseCode(name) {
  const m = name.match(CODE_RE);
  return m ? m[1] : '';
}

function cleanBrandName(folderName) {
  return folderName.replace(/^!\s*/, '').trim();
}

function cleanProductName(folderName, brand) {
  let n = stripExt(folderName).replace(CODE_RE, '').trim();
  // Remove a leading "BRAND - " that repeats the brand name
  const brandWords = brand.split(/\s*-\s*/).map(b => b.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
  const parts = n.split(/\s+-\s+/);
  if (parts.length > 1) {
    const first = parts[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    if (brandWords.includes(first) || brandWords.some(b => first === b)) parts.shift();
  }
  n = parts.join(' - ');
  // the size belongs to the variant, not the product name: drop "- 8,5 x 7 cm" style fragments
  n = n.replace(/\s*-?\s*\(?\d+(?:[.,]\d+)?\s*(?:cm)?\s*[x×X]\s*\d+(?:[.,]\d+)?(?:\s*[x×X]\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm)\)?\s*-?\s*/g, ' ');
  return n.replace(/\s{2,}/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '').trim();
}

function variantLabel(file, subPath) {
  let base = stripExt(file.name);
  base = base.replace(/^(Salinan|Copy of)\s+/i, '');
  const extra = [];
  const t = file.name.match(TYPE_RE);
  if (t) extra.push(t[1].toUpperCase());
  for (const s of subPath) {
    if (/halal/i.test(s)) extra.push('HALAL');
    else if (/transparan/i.test(s)) extra.push('Transparan');
    else if (/box/i.test(s)) extra.push('Box');
    else if (/lama/i.test(s)) extra.push('Size Lama');
    else extra.push(stripExt(s).replace(CODE_RE, '').trim());
  }
  if (/transparan/i.test(file.name) && !extra.includes('Transparan')) extra.push('Transparan');
  if (/\bdepan\b/i.test(file.name)) extra.push('Depan');
  if (/\bbelakang\b/i.test(file.name)) extra.push('Belakang');
  return { base, tags: [...new Set(extra.filter(Boolean))] };
}

function ext(name) {
  const m = name.match(FILE_EXT_RE);
  return m ? m[1].toLowerCase() : '';
}

// Supporting files that are not stickers (barcodes, QR codes, stock art, archives).
const JUNK_RE = /(\.(svg|zip|rar|txt|docx?|xlsx?)$)|^(GTIN|NA\d{6,}|collection_of)/i;

function collectFiles(node, subPath = []) {
  const out = [];
  for (const c of node.children || []) {
    if (c.isFolder) out.push(...collectFiles(c, [...subPath, c.name]));
    else if (!JUNK_RE.test(c.name)) out.push({ file: c, subPath });
  }
  return out;
}

function makeVariants(files, productVolume) {
  // Group .ai/.pdf/etc. with the same basename; prefer PDF/image as the preview file.
  const groups = new Map();
  for (const { file, subPath } of files) {
    const key = subPath.join('/') + '|' + stripExt(file.name).toLowerCase();
    if (!groups.has(key)) groups.set(key, { subPath, files: [] });
    groups.get(key).files.push(file);
  }
  const variants = [];
  for (const { subPath, files: fs } of groups.values()) {
    const rank = f => ({ pdf: 0, png: 1, jpg: 1, jpeg: 1, webp: 1, '': 2, ai: 3 }[ext(f.name)] ?? 4);
    fs.sort((a, b) => rank(a) - rank(b));
    const main = fs[0];
    const { base, tags } = variantLabel(main, subPath);
    const dimension = parseDimension(main.name) || subPath.map(parseDimension).find(Boolean) || '';
    variants.push({
      drive_file_id: main.id,
      file_name: main.name,
      name: base,
      tags,
      dimension,
      volume: parseVolume(main.name) || productVolume || '',
      file_type: ext(main.name) || 'file',
      alt_files: fs.slice(1).map(f => ({ id: f.id, name: f.name, type: ext(f.name) })),
    });
  }
  variants.sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return variants;
}

function buildCatalog(tree) {
  const brands = [];
  for (const b of tree.children || []) {
    if (!b.isFolder || !/^!/.test(b.name)) continue;
    const brandName = cleanBrandName(b.name);
    const brand = { name: brandName, drive_folder_id: b.id, products: [] };
    const pushProduct = (node, files) => {
      const code = parseCode(node.name);
      const name = cleanProductName(node.name, brandName) || stripExt(node.name);
      const volume = parseVolume(node.name);
      brand.products.push({
        code,
        name,
        drive_folder_id: node.isFolder ? node.id : null,
        volume,
        variants: makeVariants(files, volume),
      });
    };
    for (const p of b.children || []) {
      if (!p.isFolder) { pushProduct(p, [{ file: p, subPath: [] }]); continue; }
      const files = collectFiles(p);
      const code = parseCode(p.name);
      if (!code && files.length && files.every(f => parseCode(stripExt(f.file.name).replace(/^(Salinan|Copy of)\s+/i, '')))) {
        // A grouping folder (e.g. "Lebel Pouch 2 Liter"): each coded file becomes a product.
        for (const f of files) {
          const n = stripExt(f.file.name);
          pushProduct({ ...f.file, name: n.replace(/^([A-Z]{1,3}\d{2,4})\s*-\s*/, '$1. ') }, [f]);
        }
        continue;
      }
      pushProduct(p, files);
    }
    brand.products.sort((a, b) => (a.code || 'ZZZ' + a.name).localeCompare(b.code || 'ZZZ' + b.name, 'id', { numeric: true }));
    brands.push(brand);
  }
  return brands;
}

module.exports = { buildCatalog, parseDimension, parseVolume, parseCode };
