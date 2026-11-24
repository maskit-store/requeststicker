// Minimal PDF content-stream tokenizer/serializer, enough to locate and rewrite text-showing operators.

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

// Token: { t: 'num'|'name'|'str'|'hex'|'op'|'arr_open'|'arr_close'|'dict_open'|'dict_close'|'raw', v, s, e }
// s/e are byte offsets into the source so untouched regions can be copied verbatim.
function tokenize(buf) {
  const toks = [];
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const c = buf[i];
    if (WS.has(c)) { i++; continue; }
    if (c === 0x25) { while (i < n && buf[i] !== 0x0a && buf[i] !== 0x0d) i++; continue; } // comment
    const s = i;
    if (c === 0x28) { // literal string
      let depth = 1; i++;
      const bytes = [];
      while (i < n && depth > 0) {
        const ch = buf[i];
        if (ch === 0x5c) { // backslash
          const nx = buf[i + 1];
          const map = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
          if (nx in map) { bytes.push(map[nx]); i += 2; }
          else if (nx >= 0x30 && nx <= 0x37) {
            let j = i + 1, oct = '';
            while (j < n && oct.length < 3 && buf[j] >= 0x30 && buf[j] <= 0x37) oct += String.fromCharCode(buf[j++]);
            bytes.push(parseInt(oct, 8) & 0xff); i = j;
          } else if (nx === 0x0d || nx === 0x0a) { i += 2; if (nx === 0x0d && buf[i] === 0x0a) i++; }
          else { i += 2; if (nx !== undefined) bytes.push(nx); }
          continue;
        }
        if (ch === 0x28) depth++;
        if (ch === 0x29) { depth--; if (depth === 0) { i++; break; } }
        bytes.push(ch); i++;
      }
      toks.push({ t: 'str', v: Buffer.from(bytes), s, e: i });
      continue;
    }
    if (c === 0x3c && buf[i + 1] === 0x3c) { toks.push({ t: 'dict_open', s, e: i + 2 }); i += 2; continue; }
    if (c === 0x3e && buf[i + 1] === 0x3e) { toks.push({ t: 'dict_close', s, e: i + 2 }); i += 2; continue; }
    if (c === 0x3c) { // hex string
      i++; let hex = '';
      while (i < n && buf[i] !== 0x3e) { const ch = buf[i++]; if (!WS.has(ch)) hex += String.fromCharCode(ch); }
      i++;
      if (hex.length % 2) hex += '0';
      toks.push({ t: 'hex', v: Buffer.from(hex, 'hex'), s, e: i });
      continue;
    }
    if (c === 0x5b) { toks.push({ t: 'arr_open', s, e: ++i }); continue; }
    if (c === 0x5d) { toks.push({ t: 'arr_close', s, e: ++i }); continue; }
    if (c === 0x7b || c === 0x7d) { toks.push({ t: 'raw', s, e: ++i }); continue; }
    if (c === 0x2f) { // name
      i++;
      while (i < n && !WS.has(buf[i]) && !DELIM.has(buf[i])) i++;
      const raw = buf.slice(s + 1, i).toString('latin1').replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      toks.push({ t: 'name', v: raw, s, e: i });
      continue;
    }
    // number or operator keyword
    while (i < n && !WS.has(buf[i]) && !DELIM.has(buf[i])) i++;
    if (i === s) { i++; toks.push({ t: 'raw', s, e: i }); continue; }
    const word = buf.slice(s, i).toString('latin1');
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { toks.push({ t: 'num', v: parseFloat(word), s, e: i }); continue; }
    toks.push({ t: 'op', v: word, s, e: i });
    if (word === 'ID') { // inline image data: skip binary until whitespace + EI + whitespace
      let j = i + 1;
      while (j < n - 2) {
        if (buf[j] === 0x45 && buf[j + 1] === 0x49 && WS.has(buf[j - 1]) && (j + 2 >= n || WS.has(buf[j + 2]))) break;
        j++;
      }
      toks.push({ t: 'raw', s: i, e: j });
      i = j;
    }
  }
  return toks;
}

// Groups tokens into operations: { op, operands: [tokens], s, e }
function parseOps(buf) {
  const toks = tokenize(buf);
  const ops = [];
  let operands = [];
  let start = null;
  let depth = 0;
  for (const t of toks) {
    if (start === null) start = t.s;
    if (t.t === 'arr_open' || t.t === 'dict_open') depth++;
    if (t.t === 'arr_close' || t.t === 'dict_close') depth--;
    if (t.t === 'op' && depth === 0) {
      ops.push({ op: t.v, operands, s: start, e: t.e });
      operands = []; start = null;
    } else operands.push(t);
  }
  return ops;
}

function pdfName(name) {
  return '/' + name.replace(/[^!-~]|[#()<>\[\]{}\/%]/g, ch => '#' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
}

// Rebuilds a stream applying replacements: Map(opIndex -> string|'' ) in place of the op's original bytes.
function rebuild(buf, ops, replacements) {
  const parts = [];
  let cursor = 0;
  ops.forEach((o, idx) => {
    if (!replacements.has(idx)) return;
    parts.push(buf.slice(cursor, o.s));
    parts.push(Buffer.from(replacements.get(idx), 'latin1'));
    cursor = o.e;
  });
  parts.push(buf.slice(cursor));
  return Buffer.concat(parts);
}

module.exports = { tokenize, parseOps, rebuild, pdfName };
