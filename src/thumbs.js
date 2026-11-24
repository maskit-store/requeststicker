// Fetches and caches Google Drive thumbnails (works for files shared "anyone with the link").
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const CACHE_DIR = path.join(DATA_DIR, 'thumbs');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const TTL_MS = 7 * 24 * 3600 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{10,100}$/;
const inflight = new Map();

async function getThumbnail(fileId, size = 800) {
  if (!ID_RE.test(fileId)) return null;
  size = Math.min(Math.max(parseInt(size, 10) || 800, 100), 1600);
  const file = path.join(CACHE_DIR, `${fileId}_${size}.img`);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < TTL_MS) return fs.readFileSync(file);
  } catch {}
  const key = file;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const res = await fetch(`https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`, {
        redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 StickerRequestApp' },
      });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/')) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      return buf;
    } catch { return null; }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

// Detects PNG / JPEG so PDFKit can embed it; returns null for unsupported formats.
function imageKind(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  return null;
}

module.exports = { getThumbnail, imageKind };
