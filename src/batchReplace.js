// Replaces the batch number (BN) and expiry code (EXP) printed on a sticker PDF.
// The batch/exp lines in the source stickers are live text set in Courier New (Bold), e.g.
//   "BN.102603B24"  /  "BN: 072601D66"  and  "Exp.10-2029"  /  "EXP: 07-2029".
// We locate those text-show operators in the page content streams, keep the prefix exactly as the
// designer wrote it ("BN.", "EXP: " ...) and rewrite the line with an embedded Courier-style font
// (Courier New itself if the admin uploaded it, otherwise GNU FreeMono) at the same position/size/color.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream,
} = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { parseOps, rebuild, pdfName } = require('./pdfContent');

const FONT_DIR = process.env.FONT_DIR || path.join(__dirname, '..', 'fonts');

const BATCH_RE = /^(.*?(?:\bB\s?\.?\s?N\b|\bNo\.?\s*Batch\b|\bBatch(?:\s*No\.?)?|\bLOT\b)\s*[.:]?\s*)([A-Za-z0-9][A-Za-z0-9\-\/.]*\d[A-Za-z0-9\-\/.]*)\s*$/i;
const EXP_RE = /^(.*?(?:\bEXP(?:\.?\s*Date)?\b|\bE\.?D\b|\bBest\s*Before\b|\bBB\b)\s*[.:]?\s*)(\d{4,8}|\d{1,2}\s*[-\/. ]\s*\d{2,4}(?:\s*[-\/.]\s*\d{2,4})?|\d{1,2}\s*[A-Za-z]{3,9}\s*\d{2,4}|[A-Za-z]{3,9}\s*\d{2,4})\s*$/i;

// ---------- fonts ----------
function fontFile(bold) {
  const candidates = bold
    ? ['courbd.ttf', 'CourierNew-Bold.ttf', 'Courier New Bold.ttf', 'FreeMonoBold.ttf']
    : ['cour.ttf', 'CourierNew.ttf', 'Courier New.ttf', 'FreeMono.ttf'];
  for (const c of candidates) {
    const p = path.join(FONT_DIR, c);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Font pengganti tidak ditemukan di folder fonts/');
}
function fontInfo() {
  const b = path.basename(fontFile(true));
  return { bold: b, regular: path.basename(fontFile(false)), isCourierNew: !/^Free/i.test(b) };
}

// ---------- text decoding ----------
const WINANSI_EXTRA = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function parseToUnicode(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const map = new Map();
  const hexToStr = h => {
    let out = '';
    for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    if (h.length === 2) out = String.fromCharCode(parseInt(h, 16));
    return out;
  };
  for (const block of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  }
  for (const block of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[4] !== undefined) {
        const base = parseInt(m[4], 16);
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(base + (c - lo)));
      } else {
        const arr = [...m[5].matchAll(/<([0-9a-fA-F]*)>/g)].map(x => hexToStr(x[1]));
        arr.forEach((u, k) => map.set(lo + k, u));
      }
    }
  }
  return map;
}

function streamBytes(stream) {
  if (stream instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(stream).decode());
  if (stream && typeof stream.getContents === 'function') return Buffer.from(stream.getContents());
  return Buffer.alloc(0);
}

function makeFontDecoder(doc, fontDict) {
  const info = { baseFont: '', twoByte: false, decode: b => b.toString('latin1') };
  if (!(fontDict instanceof PDFDict)) return info;
  const base = fontDict.lookup(PDFName.of('BaseFont'));
  info.baseFont = base ? base.decodeText ? base.decodeText() : base.asString().replace(/^\//, '') : '';
  const subtype = fontDict.lookup(PDFName.of('Subtype'));
  info.twoByte = subtype && subtype.asString() === '/Type0';
  let cmap = null;
  const tu = fontDict.lookup(PDFName.of('ToUnicode'));
  if (tu instanceof PDFStream) { try { cmap = parseToUnicode(streamBytes(tu)); } catch {} }
  info.decode = b => {
    let out = '';
    if (info.twoByte) {
      for (let i = 0; i + 1 < b.length; i += 2) {
        const c = (b[i] << 8) | b[i + 1];
        // No ToUnicode: many TrueType fonts use the standard Macintosh glyph order (glyph id = char - 29).
        out += cmap ? (cmap.get(c) ?? '') : (c >= 3 && c < 98 ? String.fromCharCode(c + 29) : '');
      }
    } else {
      for (const c of b) out += cmap?.get(c) ?? WINANSI_EXTRA[c] ?? String.fromCharCode(c);
    }
    return out;
  };
  return info;
}

// ---------- scanning ----------
const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const bboxOf = pts => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const STROKE_COLOR_OPS = new Set(['RG', 'G', 'K', 'CS', 'SC', 'SCN']);
const PAINT_OPS = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);

// Interprets a content stream just enough to know, for every text line, its text, font, user-space
// bounding box and the graphics state in effect; and for every painted path, its bounding box.
function scanStream(buf, fontLookup, state = { font: null, size: 0 }) {
  const ops = parseOps(buf);
  const lines = [];
  const paths = [];
  let g = { ctm: I, font: state.font, size: state.size, lw: 1, strokeOps: '', Tc: 0, Tz: 100, TL: 0, Tr: 0, Ts: 0 };
  const stack = [];
  let Tm = I, Tlm = I;
  let inText = false, cur = null;
  let pathPts = [];
  const num = (o, k) => (o.operands[k] && typeof o.operands[k].v === 'number' ? o.operands[k].v : 0);
  const newLine = () => { cur = { text: '', showOps: [], font: g.font, size: g.size, pts: [] }; lines.push(cur); };
  const moveLine = (tx, ty) => { Tlm = mul([1, 0, 0, 1, tx, ty], Tlm); Tm = Tlm; };

  ops.forEach((o, idx) => {
    const op = o.op;
    switch (op) {
      case 'q': stack.push({ ...g }); break;
      case 'Q': { const s = stack.pop(); if (s) g = s; break; }
      case 'cm': g.ctm = mul(o.operands.map(t => t.v), g.ctm); break;
      case 'w': g.lw = num(o, 0); break;
      case 'Tf': g.font = o.operands[0]?.v; g.size = num(o, 1); break;
      case 'Tc': g.Tc = num(o, 0); break;
      case 'Tz': g.Tz = num(o, 0); break;
      case 'TL': g.TL = num(o, 0); break;
      case 'Tr': g.Tr = num(o, 0); break;
      case 'Ts': g.Ts = num(o, 0); break;
      case 'BT': inText = true; Tm = Tlm = I; newLine(); break;
      case 'ET': inText = false; cur = null; break;
      case 'Td': moveLine(num(o, 0), num(o, 1)); if (inText) newLine(); break;
      case 'TD': g.TL = -num(o, 1); moveLine(num(o, 0), num(o, 1)); if (inText) newLine(); break;
      case 'Tm': Tm = Tlm = o.operands.map(t => t.v); if (inText) newLine(); break;
      case 'T*': moveLine(0, -g.TL); if (inText) newLine(); break;
      case "'": case '"': case 'Tj': case 'TJ': {
        if (op === "'" || op === '"') {
          if (op === '"') { g.Tc = num(o, 1); }
          moveLine(0, -g.TL);
          if (inText) newLine();
        }
        if (!cur) newLine();
        const dec = fontLookup(g.font);
        let txt = '';
        let adv = 0; // in text space units (unscaled by font size)
        for (const t of o.operands) {
          if (t.t === 'str' || t.t === 'hex') {
            const piece = dec.decode(t.v);
            txt += piece;
            adv += piece.length * (0.6 * g.size + g.Tc) * g.Tz / 100;
          } else if (op === 'TJ' && t.t === 'num') {
            if (t.v < -250) txt += ' ';
            adv -= t.v / 1000 * g.size * g.Tz / 100;
          }
        }
        if (!cur.showOps.length) {
          Object.assign(cur, { font: g.font, size: g.size, Tr: g.Tr, lw: g.lw, strokeOps: g.strokeOps });
        }
        const M = mul(Tm, g.ctm);
        if (!cur.start) {
          cur.start = apply(M, 0, g.Ts);
          const o = apply(M, 0, 0), xa = apply(M, 1, 0), ya = apply(M, 0, g.size || 1);
          const len = Math.hypot(xa[0] - o[0], xa[1] - o[1]) || 1;
          cur.dir = [(xa[0] - o[0]) / len, (xa[1] - o[1]) / len]; // reading direction in user space
          cur.h = Math.hypot(ya[0] - o[0], ya[1] - o[1]) || g.size || 1;
        }
        cur.end = apply(M, adv, g.Ts);
        cur.pts.push(apply(M, 0, g.Ts - 0.3 * g.size), apply(M, adv, g.Ts + 0.9 * g.size));
        cur.text += txt;
        cur.showOps.push(idx);
        cur.baseFont = dec.baseFont;
        Tm = mul([1, 0, 0, 1, adv, 0], Tm);
        break;
      }
      case 'm': case 'l': pathPts.push(apply(g.ctm, num(o, 0), num(o, 1))); break;
      case 'c': pathPts.push(apply(g.ctm, num(o, 0), num(o, 1)), apply(g.ctm, num(o, 2), num(o, 3)), apply(g.ctm, num(o, 4), num(o, 5))); break;
      case 'v': case 'y': pathPts.push(apply(g.ctm, num(o, 0), num(o, 1)), apply(g.ctm, num(o, 2), num(o, 3))); break;
      case 're': {
        const [x, y, w, h] = [0, 1, 2, 3].map(k => num(o, k));
        pathPts.push(apply(g.ctm, x, y), apply(g.ctm, x + w, y + h), apply(g.ctm, x + w, y), apply(g.ctm, x, y + h));
        break;
      }
      default:
        if (STROKE_COLOR_OPS.has(op)) {
          const src = buf.slice(o.s, o.e).toString('latin1').trim();
          g.strokeOps = op === 'SC' || op === 'SCN' ? (g.strokeOps.split('\n')[0].endsWith(' CS') ? g.strokeOps.split('\n')[0] + '\n' : '') + src : src;
        } else if (PAINT_OPS.has(op)) {
          if (pathPts.length) paths.push({ idx, op, bbox: bboxOf(pathPts), lw: g.lw, strokeOps: g.strokeOps });
          pathPts = [];
        }
    }
  });
  state.font = g.font; state.size = g.size;
  for (const l of lines) l.bbox = l.pts.length ? bboxOf(l.pts) : null;
  return { ops, paths, lines: lines.filter(l => l.showOps.length) };
}

const PREFIX_ONLY_RE = /^\s*(?:B\s?\.?\s?N|No\.?\s*Batch|Batch(?:\s*No\.?)?|LOT|EXP(?:\.?\s*Date)?|E\.?D|Best\s*Before|BB)\s*[.:]?\s*$/i;

// Two text objects belong to the same printed line when they share a baseline and touch horizontally.
// Works for rotated text too: distances are measured along / across the reading direction.
function adjacent(a, b) {
  if (!a.start || !b.start || !a.end || !a.dir || !b.dir) return false;
  if (a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] < 0.98) return false;
  const h = Math.max(a.h || 1, b.h || 1);
  const dx = b.start[0] - a.end[0], dy = b.start[1] - a.end[1];
  const along = dx * a.dir[0] + dy * a.dir[1];
  const across = -dx * a.dir[1] + dy * a.dir[0];
  return Math.abs(across) < 0.35 * h && along > -0.6 * h && along < 1.2 * h;
}
const VALUE_PART_RE = /^[A-Za-z0-9\-\/.:]+$/;

// Groups consecutive text objects that form one printed line (same baseline, touching). Some exporters
// write every glyph as its own text object; Illustrator sometimes splits "EXP." and "07-2029".
function groupLines(lines) {
  const groups = [];
  let cur = null;
  for (const l of lines) {
    if (cur && (adjacent(cur.members[cur.members.length - 1], l) || (!l.text.trim() && cur.members.length))) {
      cur.members.push(l);
    } else {
      cur = { members: [l] };
      groups.push(cur);
    }
  }
  for (const g of groups) g.text = g.members.map(m => m.text).join('');
  return groups.filter(g => g.text.trim());
}

const KEYWORD_RE = /(?:\bB\s?\.?\s?N\b|\bNo\.?\s*Batch\b|\bBatch\b|\bLOT\b|\bEXP\b|\bE\.?D\b|\bBest\s*Before\b|\bBB\b)/i;

// Finds batch/exp occurrences. Returns { kind, prefix, value, line, extra, newPrefix, text }:
// `line` receives `newPrefix + <new value>`, `extra` text objects are blanked.
function findMatches(lines) {
  const out = [];
  const groups = groupLines(lines);
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const c = classify(g.text);
    if (c) {
      // Leave untouched any leading objects that come before the keyword (e.g. "Green Tea").
      const kwPos = Math.max(0, g.text.search(KEYWORD_RE));
      let offset = 0, start = 0;
      for (let k = 0; k < g.members.length; k++) {
        const len = g.members[k].text.length;
        if (offset + len > kwPos) { start = k; break; }
        offset += len;
      }
      // If the value starts its own text object ("EXP." + "07-2029"), keep the prefix objects exactly as
      // designed and rewrite only the value objects, so the original spacing is preserved.
      const valueIdx = g.text.lastIndexOf(c.value);
      let acc = 0, valueMember = -1;
      for (let k = 0; k < g.members.length; k++) {
        if (acc === valueIdx && k > start) { valueMember = k; break; }
        acc += g.members[k].text.length;
      }
      if (valueMember > 0) {
        const vals = g.members.slice(valueMember);
        out.push({ ...c, line: vals[0], extra: vals.slice(1), newPrefix: '', text: g.text.trim() });
        continue;
      }
      const rewrite = g.members.slice(start);
      const memberLead = g.text.slice(offset, kwPos).replace(/^\s+/, '');
      const newPrefix = memberLead + c.prefix.slice(Math.max(0, c.prefix.search(KEYWORD_RE)));
      out.push({ ...c, line: rewrite[0], extra: rewrite.slice(1), newPrefix, text: g.text.trim() });
      continue;
    }
    if (PREFIX_ONLY_RE.test(g.text)) {
      const ng = groups[gi + 1];
      if (!ng) continue;
      const joined = g.text.trim() + ng.text.trim();
      const c2 = classify(joined) || classify(g.text.trim() + ' ' + ng.text.trim());
      if (c2 && VALUE_PART_RE.test(ng.text.trim().replace(/\s+/g, ''))) {
        out.push({ ...c2, line: ng.members[0], extra: ng.members.slice(1), newPrefix: '', text: joined });
        gi++;
      }
    }
  }
  return out;
}

function classify(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  let m = t.match(EXP_RE);
  if (m) return { kind: 'exp', prefix: m[1], value: m[2] };
  m = t.match(BATCH_RE);
  if (m) return { kind: 'batch', prefix: m[1], value: m[2] };
  return null;
}

// Visit every content stream of every page (and nested Form XObjects).
function* contentTargets(doc) {
  const pages = doc.getPages();
  const seenForms = new Set();
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    const resources = page.node.Resources();
    const contents = page.node.get(PDFName.of('Contents'));
    const refs = [];
    const resolved = doc.context.lookup(contents);
    if (resolved instanceof PDFArray) for (let i = 0; i < resolved.size(); i++) refs.push(resolved.get(i));
    else if (contents) refs.push(contents);
    // Page content may be split over several streams (even mid-path), so treat them as one.
    const streams = refs.map(r => doc.context.lookup(r)).filter(st => st instanceof PDFStream);
    if (streams.length) {
      yield {
        page: p, ref: refs[0], stream: streams[0], resources, pageObj: page, isPage: true, refs,
        bytes: () => Buffer.concat(streams.flatMap(st => [streamBytes(st), Buffer.from('\n')])),
      };
    }
    yield* formTargets(doc, resources, p, seenForms);
  }
}
function* formTargets(doc, resources, p, seen) {
  if (!(resources instanceof PDFDict)) return;
  const xo = resources.lookup(PDFName.of('XObject'));
  if (!(xo instanceof PDFDict)) return;
  for (const [, ref] of xo.entries()) {
    if (!(ref instanceof PDFRef) || seen.has(ref.toString())) continue;
    const st = doc.context.lookup(ref);
    if (!(st instanceof PDFStream)) continue;
    const sub = st.dict.lookup(PDFName.of('Subtype'));
    if (!sub || sub.asString() !== '/Form') continue;
    seen.add(ref.toString());
    const res = st.dict.lookup(PDFName.of('Resources')) || resources;
    yield { page: p, ref, stream: st, resources: res, isPage: false };
    yield* formTargets(doc, res, p, seen);
  }
}

function fontLookupFor(doc, resources) {
  const cache = new Map();
  const fonts = resources instanceof PDFDict ? resources.lookup(PDFName.of('Font')) : null;
  return name => {
    if (cache.has(name)) return cache.get(name);
    const fd = fonts instanceof PDFDict && name ? fonts.lookup(PDFName.of(name)) : null;
    const dec = makeFontDecoder(doc, fd);
    cache.set(name, dec);
    return dec;
  };
}

async function loadPdf(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  doc.registerFontkit(fontkit);
  return doc;
}

// Detect current batch/exp values (used to show the admin what will be replaced).
async function detect(bytes) {
  const doc = await loadPdf(bytes);
  const found = [];
  const states = new Map();
  for (const tgt of contentTargets(doc)) {
    if (!(tgt.stream instanceof PDFStream)) continue;
    const state = tgt.isPage ? (states.get(tgt.page) || states.set(tgt.page, { font: null, size: 0 }).get(tgt.page)) : { font: null, size: 0 };
    const buf = tgt.bytes ? tgt.bytes() : streamBytes(tgt.stream);
    const { lines } = scanStream(buf, fontLookupFor(doc, tgt.resources), state);
    for (const m of findMatches(lines)) {
      found.push({ page: tgt.page + 1, kind: m.kind, prefix: m.prefix, value: m.value, text: m.text, font: m.line.baseFont, size: m.line.size });
    }
  }
  return found;
}

function deflateStream(doc, oldStream, bytes) {
  const dict = oldStream.dict.clone(doc.context);
  dict.delete(PDFName.of('DecodeParms'));
  dict.delete(PDFName.of('Length'));
  dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  return PDFRawStream.of(dict, zlib.deflateSync(bytes));
}

function setFontResource(doc, resources, key, fontRef) {
  let fonts = resources.lookup(PDFName.of('Font'));
  if (!(fonts instanceof PDFDict)) { fonts = doc.context.obj({}); resources.set(PDFName.of('Font'), fonts); }
  fonts.set(PDFName.of(key), fontRef);
}

// Remove Illustrator private editing data (it still contains the OLD batch text and makes the file huge)
// and drop objects that are no longer reachable.
function stripPrivateData(doc) {
  for (const page of doc.getPages()) page.node.delete(PDFName.of('PieceInfo'));
  doc.catalog.delete(PDFName.of('PieceInfo'));
  const ctx = doc.context;
  const reachable = new Set();
  const visit = obj => {
    if (obj instanceof PDFRef) {
      const k = obj.toString();
      if (reachable.has(k)) return;
      reachable.add(k);
      visit(ctx.lookup(obj));
    } else if (obj instanceof PDFDict) { for (const [, v] of obj.entries()) visit(v); }
    else if (obj instanceof PDFArray) { for (let i = 0; i < obj.size(); i++) visit(obj.get(i)); }
    else if (obj instanceof PDFStream) visit(obj.dict);
  };
  visit(ctx.trailerInfo.Root);
  if (ctx.trailerInfo.Info) visit(ctx.trailerInfo.Info);
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!reachable.has(ref.toString())) ctx.delete(ref);
}

/**
 * @param {Buffer} bytes source PDF
 * @param {{batch?: string, exp?: string}} values new values (without prefix)
 * @returns {{ pdf: Buffer, replaced: Array, verify: Array }}
 */
async function replaceBatchExp(bytes, values) {
  const batch = (values.batch || '').trim();
  const exp = (values.exp || '').trim();
  if (!batch && !exp) throw new Error('Isi nomor batch dan/atau kode expired.');
  const doc = await loadPdf(bytes);
  const embedded = {};
  const getFont = async bold => {
    const k = bold ? 'b' : 'r';
    if (!embedded[k]) embedded[k] = await doc.embedFont(fs.readFileSync(fontFile(bold)), { subset: true });
    return embedded[k];
  };
  const replaced = [];
  const states = new Map();
  // Pass 1: scan everything so stroke "ghost" outlines can be matched even across content streams.
  const scans = [];
  for (const tgt of [...contentTargets(doc)]) {
    if (!(tgt.stream instanceof PDFStream)) continue;
    const state = tgt.isPage ? (states.get(tgt.page) || states.set(tgt.page, { font: null, size: 0 }).get(tgt.page)) : { font: null, size: 0 };
    const buf = tgt.bytes ? tgt.bytes() : streamBytes(tgt.stream);
    const scan = scanStream(buf, fontLookupFor(doc, tgt.resources), state);
    const matches = findMatches(scan.lines).filter(m => (m.kind === 'batch' ? batch : exp));
    scans.push({ tgt, buf, ...scan, matches, repl: new Map() });
  }
  // Pass 2: neutralise stroke-only paths that sit inside a replaced line's box. Illustrator expands a
  // text "appearance stroke" into separate path outlines of the OLD glyphs; left alone they ghost through.
  const inside = (bb, box, margin) => bb[0] >= box[0] - margin && bb[1] >= box[1] - margin && bb[2] <= box[2] + margin && bb[3] <= box[3] + margin;
  for (const sc of scans) {
    const peers = sc.tgt.isPage ? scans.filter(o => o.tgt.isPage && o.tgt.page === sc.tgt.page) : [sc];
    for (const p of sc.paths) {
      if (p.op !== 'S' && p.op !== 's') continue;
      for (const peer of peers) {
        const hit = peer.matches.find(m => [m.line, ...(m.extra || [])].some(l => l.bbox && inside(p.bbox, l.bbox, 1 + p.lw)));
        if (hit) {
          sc.repl.set(p.idx, 'n');
          if (!hit.ghost) hit.ghost = { lw: p.lw, strokeOps: p.strokeOps };
          break;
        }
      }
    }
  }
  // Pass 3: rewrite the text.
  for (const sc of scans) {
    const { tgt, ops, repl } = sc;
    for (const m of sc.matches) {
      const c = m, l = m.line;
      const newValue = c.kind === 'batch' ? batch : exp;
      const bold = /bold|black|heavy/i.test(l.baseFont || '') || !/courier/i.test(l.baseFont || '');
      const font = await getFont(bold);
      const resKey = bold ? 'FBNEXPB' : 'FBNEXPR';
      setFontResource(doc, tgt.resources, resKey, font.ref);
      const newText = m.newPrefix + newValue;
      const hex = font.encodeText(newText).toString();
      const first = ops[l.showOps[0]];
      let lead = '';
      if (first.op === "'") lead = 'T* ';
      if (first.op === '"') lead = `${first.operands[0].v} Tw ${first.operands[1].v} Tc T* `;
      let strokeOn = '', strokeOff = '';
      if (m.ghost && l.Tr === 0) { // re-create the designer's stroke on the new text
        strokeOn = `2 Tr ${m.ghost.lw} w ${m.ghost.strokeOps || '0 G'} `;
        strokeOff = ` ${l.Tr} Tr ${l.lw} w ${l.strokeOps || '0 G'}`;
      }
      const origFont = l.font ? ` ${pdfName(l.font)} ${l.size} Tf` : '';
      repl.set(l.showOps[0], `${lead}${strokeOn}${pdfName(resKey)} ${l.size} Tf ${hex} Tj${strokeOff}${origFont}`);
      for (const k of l.showOps.slice(1)) repl.set(k, '');
      for (const e of m.extra || []) for (const k of e.showOps) repl.set(k, '');
      replaced.push({ page: tgt.page + 1, kind: c.kind, before: m.text, after: (c.prefix + newValue).trim(), font: l.baseFont, stroke: !!m.ghost });
    }
    if (repl.size) {
      const out = rebuild(sc.buf, ops, repl);
      doc.context.assign(tgt.ref, deflateStream(doc, tgt.stream, out));
      if (tgt.refs && tgt.refs.length > 1) tgt.pageObj.node.set(PDFName.of('Contents'), tgt.ref);
    }
  }
  if (!replaced.length) {
    const err = new Error('Teks nomor batch / expired tidak ditemukan di file ini (kemungkinan teks sudah di-outline atau formatnya berbeda).');
    err.code = 'NOT_FOUND';
    throw err;
  }
  stripPrivateData(doc);
  const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
  const verify = await detect(pdf);
  return { pdf, replaced, verify };
}

module.exports = { detect, replaceBatchExp, classify, fontInfo, _scanStream: scanStream, _findMatches: findMatches };
