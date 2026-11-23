// Crawl the Google Drive sticker database and save it as the offline seed (seed/drive-tree.json),
// and import it into the local database.
const fs = require('fs');
const path = require('path');
const { crawl } = require('../src/driveCrawler');
const { DEFAULT_ROOT, importCatalog, brandOnly } = require('../src/catalogSync');
const { buildCatalog } = require('../src/catalogParser');

(async () => {
  const root = process.argv[2] || process.env.DRIVE_ROOT_ID || DEFAULT_ROOT;
  console.log('Crawling Drive folder', root, '...');
  const tree = await crawl(root, { shouldDescend: brandOnly, onProgress: (d, q) => process.stdout.write(`\r  folders: ${d}, queued: ${q}   `) });
  // keep only brand folders ("! Brand") in the seed - vendor archive folders are not needed
  tree.children = tree.children.filter(c => /^!/.test(c.name));
  tree.crawled_at = new Date().toISOString();
  const strip = n => { const o = { i: n.id, n: n.name }; if (n.isFolder) o.c = (n.children || []).map(strip); return o; };
  fs.writeFileSync(path.join(__dirname, '..', 'seed', 'drive-tree.json'), JSON.stringify({ crawled_at: tree.crawled_at, c: tree.children.map(strip) }));
  console.log('\nSeed saved. Importing...');
  console.log(importCatalog(buildCatalog(tree)));
})().catch(e => { console.error(e); process.exit(1); });
