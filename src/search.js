// Typo- and spelling-tolerant product search ("deterjen" finds "Detergent", "sampo" finds "Shampoo").
// Every query word must match something in the product (code, name, brand, variant/file names) — exactly,
// as a prefix, via a phonetic form, via an Indonesian↔English synonym, or within a small edit distance.

const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = s => strip(s).split(/[^a-z0-9]+/).filter(t => t.length > 0);

// Rough phonetic key that merges common Indonesian/English spelling differences.
function phon(t) {
  if (/^\d+$/.test(t)) return t;
  let s = t
    .replace(/tion/g, 'sion').replace(/ph/g, 'f').replace(/sh/g, 's').replace(/ch/g, 'c').replace(/ck/g, 'k')
    .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/j/g, 'g').replace(/z/g, 's').replace(/v/g, 'f').replace(/y/g, 'i').replace(/w/g, 'u')
    .replace(/ea|ee|ie/g, 'i').replace(/oo|ou/g, 'u').replace(/o/g, 'u').replace(/ai|ay/g, 'e')
    .replace(/([a-z])\1+/g, '$1').replace(/([^aeiou])h/g, '$1');
  if (s.length > 3) s = s.replace(/e$/, '');
  return s;
}

// Indonesian ↔ English words that appear on the sticker titles.
const SYN_GROUPS = [
  ['deterjen', 'detergent'], ['sabun', 'soap', 'wash'], ['sampo', 'shampoo'], ['kondisioner', 'conditioner'],
  ['pelembut', 'softener'], ['pewangi', 'parfum', 'perfume', 'fragrance', 'perfumed'], ['losion', 'lotion'], ['krim', 'cream'],
  ['pembersih', 'cleaner', 'cleanser'], ['cair', 'liquid'], ['bayi', 'baby'], ['anak', 'kids', 'kid', 'child'],
  ['cuci', 'wash'], ['mandi', 'bath', 'shower', 'body'], ['piring', 'dish'], ['lantai', 'floor'], ['pakaian', 'baju', 'laundry', 'fabric'], ['gigi', 'tooth', 'teeth'],
  ['pasta', 'paste'], ['tabir', 'sunscreen'], ['surya', 'sun'], ['wajah', 'muka', 'face'], ['rambut', 'hair'],
  ['tubuh', 'badan', 'body'], ['tangan', 'hand'], ['kaki', 'foot', 'feet'], ['minyak', 'oil'], ['kucing', 'cat'],
  ['anjing', 'dog'], ['hewan', 'pet'], ['semut', 'ant'], ['nyamuk', 'mosquito'], ['kecoa', 'cockroach'],
  ['pengusir', 'repellent', 'repellen'], ['kutu', 'flea', 'tick'], ['cacing', 'worm', 'dewormer'], ['mata', 'eye'],
  ['telinga', 'ear'], ['luka', 'wound'], ['vitamin', 'vit'], ['susu', 'milk'], ['kambing', 'goat'], ['makanan', 'pakan', 'food', 'meal'],
  ['camilan', 'cemilan', 'snack'], ['bubuk', 'serbuk', 'powder'], ['semprot', 'spray'], ['tetes', 'drop', 'drops'],
  ['disinfektan', 'disinfectant'], ['antiseptik', 'antiseptic'], ['bau', 'odor', 'odour'], ['label', 'lebel', 'stiker', 'sticker'],
  ['botol', 'bottle'], ['dot', 'nipple'], ['mainan', 'toys', 'toy'], ['jeruk', 'orange', 'lemon'], ['stroberi', 'strawberry'],
  ['mangga', 'mango'], ['apel', 'apple'], ['pisang', 'banana'], ['alpukat', 'avocado'], ['ayam', 'chicken'], ['sapi', 'beef'],
  ['ikan', 'fish'], ['kepiting', 'crab'], ['udang', 'shrimp'], ['jamur', 'mushroom', 'fungal'], ['kelapa', 'coconut'],
  ['kecap', 'soy'], ['saus', 'sauce'], ['sirup', 'syrup'], ['teh', 'tea'], ['hijau', 'green'], ['madu', 'honey'],
  ['jerawat', 'acne'], ['pencerah', 'brightening', 'bright'], ['pelembab', 'pelembap', 'moisturizer', 'moisturizing'],
  ['kantong', 'pouch'], ['kotak', 'box'], ['isi', 'ulang', 'refill'], ['obat', 'medicine', 'medicated'],
  ['batuk', 'cough'], ['demam', 'fever'], ['diare', 'diarrhea'], ['ketiak', 'deodorant', 'deo'], ['gatal', 'itch', 'itchy'],
];
const SYN = new Map();
for (const g of SYN_GROUPS) for (const w of g) {
  const set = SYN.get(w) || new Set();
  for (const x of g) if (x !== w) set.add(x);
  SYN.set(w, set);
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const maxEdits = n => (n <= 3 ? 0 : n <= 5 ? 1 : 2);

// Score how well one query word matches one document word (0 = no match).
function wordScore(q, d, qp, dp) {
  if (q === d) return 10;
  if (d.startsWith(q)) return q.length >= 2 ? 8 : 0;
  if (q.length >= 3 && d.includes(q)) return 6;
  if (/\d/.test(q) || /^\d+$/.test(d)) return 0; // codes & numbers: no fuzzy matching (M141 must not find M142)
  if (qp.length >= 3 && (dp === qp || dp.startsWith(qp))) return 7;
  const m = maxEdits(q.length);
  if (!m) return 0;
  const whole = lev(qp, dp, m);
  if (whole <= m) return 5 - whole;                          // typo in a whole word
  if (dp.length > qp.length && lev(qp, dp.slice(0, qp.length), m) <= m) return 3; // typo while still typing
  return 0;
}

// Build a search document for a product.
function makeDoc(fields) {
  const words = [...new Set(tokens(fields.join(' ')))];
  return { words, phons: words.map(phon), text: strip(fields.join(' ')) };
}

// Best match of a query word against a document; synonyms count slightly less.
function matchWord(q, doc) {
  const qp = phon(q);
  let best = 0, hit = null;
  for (let i = 0; i < doc.words.length; i++) {
    const s = wordScore(q, doc.words[i], qp, doc.phons[i]);
    if (s > best) { best = s; hit = doc.words[i]; }
  }
  for (const syn of SYN.get(q) || []) {
    const sp = phon(syn);
    for (let i = 0; i < doc.words.length; i++) {
      const s = wordScore(syn, doc.words[i], sp, doc.phons[i]) * 0.9;
      if (s > best) { best = s; hit = doc.words[i]; }
    }
  }
  return { score: best, hit };
}

// Returns { score, hits } or null when some query word has no match.
function scoreDoc(query, doc) {
  const qw = tokens(query).slice(0, 8);
  if (!qw.length) return { score: 0, hits: [] };
  let total = 0;
  const hits = [];
  for (const q of qw) {
    const { score, hit } = matchWord(q, doc);
    if (!score) return null;
    total += score;
    hits.push({ q, hit, exact: !!hit && hit.includes(q) });
  }
  if (doc.text.includes(strip(query).trim())) total += 5; // whole phrase present
  return { score: total, hits };
}

// "Did you mean": replace query words that only matched fuzzily with the catalog word they matched most often.
function didYouMean(query, scored) {
  const qw = tokens(query);
  const fixes = new Map();
  for (const s of scored.slice(0, 20)) for (const h of s.hits) {
    if (h.exact || !h.hit || h.hit === h.q) continue;
    const m = fixes.get(h.q) || new Map();
    m.set(h.hit, (m.get(h.hit) || 0) + 1);
    fixes.set(h.q, m);
  }
  if (!fixes.size) return '';
  return qw.map(w => {
    const m = fixes.get(w);
    return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : w;
  }).join(' ');
}

module.exports = { tokens, phon, makeDoc, scoreDoc, didYouMean, lev };
