// Masa simpan (shelf life) per kategori produk — ketentuan internal Sainsgo.
// The generator pre-fills the shelf life from a suggested category; the designer confirms or edits it.
const CATEGORIES = [
  { id: 'herbal_cair', group: 'Obat Herbal', label: 'Obat Herbal Cair Manusia', years: 2 },
  { id: 'herbal_cair_luar', group: 'Obat Herbal', label: 'Obat Herbal Cair Luar Manusia', years: 2 },
  { id: 'herbal_serbuk', group: 'Obat Herbal', label: 'Obat Herbal Serbuk Manusia', years: 2 },
  { id: 'herbal_kapsul', group: 'Obat Herbal', label: 'Obat Herbal Kapsul Manusia', years: 2 },
  { id: 'hewan_kapsul', group: 'Obat Hewan', label: 'Obat Hewan Kapsul Herbal', years: 3 },
  { id: 'hewan_cair', group: 'Obat Hewan', label: 'Obat Hewan Cair', years: 1 },
  { id: 'hewan_serbuk', group: 'Obat Hewan', label: 'Obat Hewan Serbuk', years: 3 },
  { id: 'kosmetik_hewan', group: 'Kosmetik Hewan', label: 'Kosmetik Hewan', years: 3 },
  { id: 'pangan_hewan', group: 'Pangan Hewan', label: 'Pangan Hewan', years: 2 },
  { id: 'md_padat', group: 'Pangan Manusia', label: 'MD Padat Manusia', years: 2 },
  { id: 'md_cair', group: 'Pangan Manusia', label: 'MD Cair Manusia', years: 2 },
  { id: 'pkrt', group: 'PKRT / Home Care', label: 'PKRT', years: 3 },
  { id: 'kecantikan', group: 'Kosmetik Manusia', label: 'Produk Kecantikan', years: 3 },
  { id: 'adult_care', group: 'Kosmetik Manusia', label: 'Adult Personal Care', years: 3 },
  { id: 'baby_kids_care', group: 'Kosmetik Manusia', label: 'Baby & Kids Personal Care', years: 3 },
];
const BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

const has = (s, re) => re.test(s);
const PET_BRANDS = /wonderpaw/i;
const PKRT_RE = /deterjen|detergent|laundry|softener|pelembut|pewangi pakaian|disinfect|desinfek|cleaner|pembersih|cuci piring|dish|floor|lantai|repell?en|anti (semut|kecoa|nyamuk)|semut|kecoa|rayap|tungau|room spray|linen|fabric|helm|sepatu|lens|kulkas|kulukas|odor remover|toys? ?& ?accessories|bottle|nipple|sterili/i;
const BEAUTY_RE = /serum|face|wajah|sunscreen|mist|toner|masker|mask|lip|eye|glow|bright|acne|jerawat|cream|krim|gel|essence|moistur|skin|firming|hydra/i;
const BABY_RE = /baby|bayi|kids?\b|anak|teens?|toddler|mama/i;
const CAPS_RE = /kapsul|capsule|kaplet|tablet/i;
const POWDER_RE = /serbuk|bubuk|powder|sachet|granul|\d+\s*(g|gr|gram|kg)\b/i;
const LIQUID_FOOD_RE = /kecap|saus|sauce|sirup|syrup|minyak|oil|cair|liquid|drink(?! powder)|\d+\s*ml\b/i;

// Suggest a category from brand + product name + volume. Returns { id, reason }.
function suggestCategory({ brand = '', name = '', volume = '' }) {
  const s = `${name} ${volume}`;
  // Pet products
  if (PET_BRANDS.test(brand) || /\b(pets?|kucing|anjing|hamster|bunny|kelinci|reptile|cats?|dogs?)\b/i.test(s)) {
    if (has(s, /repell?en|disinfect|odor remover|anti pooping/i)) return { id: 'pkrt', reason: 'pengusir / disinfektan untuk hewan' };
    if (has(s, /floss|freeze dried|snack|food|meal|treat|bites|hay\b/i)) return { id: 'pangan_hewan', reason: 'makanan / camilan hewan' };
    if (has(s, CAPS_RE) || has(s, /obat|medicated|antibiotik|dewormer|cacing|parasit|tetes|eye wash|saline|ear rinse|wound|luka|vitamin|vit\.?\b|multivitamin|supplement|suplemen|booster|immun|probiotic|progut|herbal|respir|p3k/i)) {
      if (has(s, CAPS_RE)) return { id: 'hewan_kapsul', reason: 'obat/vitamin hewan bentuk kapsul' };
      if (has(s, POWDER_RE) && !has(s, /\d+\s*ml\b/i)) return { id: 'hewan_serbuk', reason: 'obat/vitamin hewan bentuk serbuk' };
      return { id: 'hewan_cair', reason: 'obat/vitamin hewan bentuk cair' };
    }
    if (has(s, /shampoo|sampo|conditioner|detangler|perfume|parfum|magic powder|dry shampoo|grooming|oral care|cologne/i)) return { id: 'kosmetik_hewan', reason: 'perawatan / kosmetik hewan' };
    if (has(s, /food|meal|snack|hay|milk|susu|tea|chicken|beef|tuna|treat|makanan|pakan|bites|oil supplement|omega|coconut/i)) return { id: 'pangan_hewan', reason: 'makanan / camilan hewan' };
    return { id: 'kosmetik_hewan', reason: 'produk hewan (periksa kembali)' };
  }
  // Traditional medicine brands (OT)
  if (/tumgo|nafazy|ceranova/i.test(brand) || has(s, /obat herbal|\bjamu\b|\bherbal\b/i)) {
    if (has(s, CAPS_RE)) return { id: 'herbal_kapsul', reason: 'obat herbal bentuk kapsul' };
    if (has(s, POWDER_RE)) return { id: 'herbal_serbuk', reason: 'obat herbal bentuk serbuk' };
    if (has(s, /oles|gosok|balsem|minyak (telon|angin|urut)|luar/i)) return { id: 'herbal_cair_luar', reason: 'obat herbal cair pemakaian luar' };
    return { id: 'herbal_cair', reason: 'obat herbal bentuk cair' };
  }
  // Food
  if (/twinbi|indogredient/i.test(brand) || has(s, /kaldu|bumbu|abon|kecap|sirup|minuman|seasoning|drink powder/i)) {
    if (has(s, /powder|serbuk|bubuk|kaldu|bumbu|abon|floss|tepung|oat|tabur/i)) return { id: 'md_padat', reason: 'pangan olahan padat / serbuk' };
    if (has(s, LIQUID_FOOD_RE)) return { id: 'md_cair', reason: 'pangan olahan cair' };
    return { id: 'md_padat', reason: 'pangan olahan' };
  }
  // Human medicine in this company is herbal (handled above); remaining "obat/vitamin" items are pet products.
  if (has(s, /\b(obat|vitamin)\b/i)) return has(s, CAPS_RE) ? { id: 'hewan_kapsul', reason: 'obat/vitamin hewan (periksa kembali)' } : { id: 'hewan_cair', reason: 'obat/vitamin hewan (periksa kembali)' };
  if (/dotty/i.test(brand) || has(s, PKRT_RE)) return { id: 'pkrt', reason: 'perbekalan kesehatan rumah tangga' };
  if (/dermeon/i.test(brand)) return { id: 'kecantikan', reason: 'produk kecantikan' };
  if (has(s, BABY_RE)) return { id: 'baby_kids_care', reason: 'perawatan bayi & anak' };
  if (has(s, BEAUTY_RE)) return { id: 'kecantikan', reason: 'produk kecantikan / perawatan wajah' };
  return { id: 'adult_care', reason: 'perawatan tubuh dewasa' };
}

module.exports = { CATEGORIES, BY_ID, suggestCategory };
