// Crawl a public ("anyone with the link") Google Drive folder tree without an API key,
// using Drive's embeddedfolderview HTML listing.
const ENTRY_RE = /<div class="flip-entry" id="entry-([^"]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g;

function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

async function listFolder(folderId) {
  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 StickerRequestApp' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for folder ${folderId}`);
      const html = await res.text();
      const out = [];
      let m;
      ENTRY_RE.lastIndex = 0;
      while ((m = ENTRY_RE.exec(html))) {
        const [, id, href, title] = m;
        out.push({ id, name: decode(title), isFolder: href.includes('/folders/'), url: decode(href) });
      }
      return out;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Returns a tree: { id, name, isFolder, children: [...] }
async function crawl(rootId, { maxDepth = 6, concurrency = 6, onProgress, shouldDescend = () => true } = {}) {
  const root = { id: rootId, name: 'ROOT', isFolder: true, children: [] };
  const queue = [{ node: root, depth: 0 }];
  let active = 0, done = 0;
  await new Promise((resolve, reject) => {
    const pump = () => {
      if (!queue.length && !active) return resolve();
      while (active < concurrency && queue.length) {
        const { node, depth } = queue.shift();
        active++;
        listFolder(node.id).then(children => {
          node.children = children.map(c => ({ ...c, children: c.isFolder ? [] : undefined }));
          if (depth + 1 < maxDepth) {
            for (const c of node.children) if (c.isFolder && shouldDescend(c, depth)) queue.push({ node: c, depth: depth + 1 });
          }
          done++;
          onProgress && onProgress(done, queue.length + active - 1);
        }).catch(reject).finally(() => { active--; pump(); });
      }
    };
    pump();
  });
  return root;
}

module.exports = { listFolder, crawl };
