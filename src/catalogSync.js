const fs = require('fs');
const path = require('path');
const { db, tx, setSetting, getSetting } = require('./db');
const { crawl } = require('./driveCrawler');
const { buildCatalog } = require('./catalogParser');

const DEFAULT_ROOT = '1GsGIB3-t1CGPKtiqNj7ImMG6Xfj3iPPx';
const SEED_PATH = path.join(__dirname, '..', 'seed', 'drive-tree.json');

const driveFolderLink = id => id ? `https://drive.google.com/drive/folders/${id}` : '';
const driveFileLink = id => id ? `https://drive.google.com/file/d/${id}/view` : '';

// Upsert the parsed catalog. Rows that came from Drive and are no longer present are deactivated;
// rows created manually by admin are never touched.
function importCatalog(brands) {
  const stats = { brands: 0, products: 0, variants: 0, newProducts: 0, newVariants: 0, deactivated: 0 };
  tx(() => {
    const seenProducts = new Set();
    const seenVariants = new Set();
    const findBrand = db.prepare('SELECT id FROM brands WHERE name = ?');
    const insBrand = db.prepare('INSERT INTO brands(name, drive_folder_id) VALUES(?, ?)');
    const updBrand = db.prepare('UPDATE brands SET drive_folder_id = ?, active = 1 WHERE id = ?');
    const findProd = db.prepare('SELECT id FROM products WHERE drive_key = ?');
    const insProd = db.prepare(`INSERT INTO products(brand_id, code, name, volume, drive_key, drive_link, source)
                                VALUES(?,?,?,?,?,?,'drive')`);
    const updProd = db.prepare(`UPDATE products SET brand_id=?, code=?, name=?, volume=?, drive_link=?, active=1,
                                updated_at=datetime('now') WHERE id=?`);
    const findVar = db.prepare('SELECT id FROM variants WHERE drive_file_id = ?');
    const insVar = db.prepare(`INSERT INTO variants(product_id, name, dimension, volume, tags, drive_file_id, drive_link,
                               file_name, file_type, alt_files, package_type, source) VALUES(?,?,?,?,?,?,?,?,?,?,?,'drive')`);
    const updVar = db.prepare(`UPDATE variants SET product_id=?, name=?, dimension=?, volume=?, tags=?, drive_link=?,
                               file_name=?, file_type=?, alt_files=?, active=1,
                               package_type = CASE WHEN package_type_manual = 1 THEN package_type ELSE ? END WHERE id=?`);

    for (const b of brands) {
      let brow = findBrand.get(b.name);
      const brandId = brow ? brow.id : Number(insBrand.run(b.name, b.drive_folder_id).lastInsertRowid);
      if (brow) updBrand.run(b.drive_folder_id, brandId);
      stats.brands++;
      for (const p of b.products) {
        const key = p.drive_folder_id ? `folder:${p.drive_folder_id}` : `file:${p.variants[0]?.drive_file_id}`;
        const link = p.drive_folder_id ? driveFolderLink(p.drive_folder_id) : driveFileLink(p.variants[0]?.drive_file_id);
        const prow = findProd.get(key);
        let pid;
        if (prow) { pid = prow.id; updProd.run(brandId, p.code, p.name, p.volume, link, pid); }
        else { pid = Number(insProd.run(brandId, p.code, p.name, p.volume, key, link).lastInsertRowid); stats.newProducts++; }
        seenProducts.add(pid);
        stats.products++;
        for (const v of p.variants) {
          const args = [pid, v.name, v.dimension, v.volume, JSON.stringify(v.tags), driveFileLink(v.drive_file_id),
            v.file_name, v.file_type, JSON.stringify(v.alt_files)];
          const vrow = findVar.get(v.drive_file_id);
          let vid;
          if (vrow) { vid = vrow.id; updVar.run(...args, v.package_type, vid); }
          else {
            vid = Number(insVar.run(pid, v.name, v.dimension, v.volume, JSON.stringify(v.tags), v.drive_file_id,
              driveFileLink(v.drive_file_id), v.file_name, v.file_type, JSON.stringify(v.alt_files), v.package_type).lastInsertRowid);
            stats.newVariants++;
          }
          seenVariants.add(vid);
          stats.variants++;
        }
      }
    }
    for (const r of db.prepare(`SELECT id FROM products WHERE source='drive' AND active=1`).all()) {
      if (!seenProducts.has(r.id)) { db.prepare('UPDATE products SET active=0 WHERE id=?').run(r.id); stats.deactivated++; }
    }
    for (const r of db.prepare(`SELECT id FROM variants WHERE source='drive' AND active=1`).all()) {
      if (!seenVariants.has(r.id)) { db.prepare('UPDATE variants SET active=0 WHERE id=?').run(r.id); stats.deactivated++; }
    }
  });
  return stats;
}

// Only descend into brand folders ("! Brand") at the top level; vendor archive folders are skipped.
const brandOnly = (node, depth) => depth > 0 || /^!/.test(node.name);
const expand = n => ({ id: n.i, name: n.n, isFolder: !!n.c, children: n.c ? n.c.map(expand) : undefined });

let running = null;
async function syncFromDrive(rootId = getSetting('drive_root_id', DEFAULT_ROOT)) {
  if (running) return running;
  running = (async () => {
    try {
      const tree = await crawl(rootId, { shouldDescend: brandOnly });
      const stats = importCatalog(buildCatalog(tree));
      setSetting('last_sync', new Date().toISOString());
      setSetting('last_sync_stats', JSON.stringify(stats));
      require('./sku').applySeedSkuMap();
      return stats;
    } finally { running = null; }
  })();
  return running;
}

function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (n > 0 || !fs.existsSync(SEED_PATH)) return null;
  const raw = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const tree = { id: 'ROOT', name: 'ROOT', isFolder: true, children: raw.c.map(expand), crawled_at: raw.crawled_at };
  const stats = importCatalog(buildCatalog(tree));
  setSetting('last_sync', tree.crawled_at || new Date().toISOString());
  setSetting('last_sync_stats', JSON.stringify(stats));
  return stats;
}

module.exports = { brandOnly, importCatalog, syncFromDrive, seedIfEmpty, DEFAULT_ROOT, driveFileLink, driveFolderLink, isSyncing: () => !!running };
