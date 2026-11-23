# Sistem Request Cetak Sticker Kemasan

Web app admin & user untuk mengajukan cetak sticker kemasan, langsung dari database sticker di Google Drive.

![Sampel ganti batch & expired](docs/sampel-batch-exp.png)

## Fitur

**User / tim**
- Pilih **brand** → **cari nama sticker** (nama / kode / nama file) → pilih **variasi** (volume, label/box, transparan, halal, dll).
- Setiap variasi menampilkan **gambar visual** (thumbnail dari Drive, bisa diperbesar) dan **ukuran dimensi** yang diambil dari nama file (mis. `8,5 x 7 cm`).
- Isi **jumlah cetak**, **supplier** (Kame, PWD, Jawara Pouch, Flexypack Sachet & Pouch, Juke Sachet & Pouch, Lainnya), **tanggal request**; satu request bisa berisi banyak sticker.

**Persetujuan** — Desainer, Manager Desain, dan Purchasing wajib **ACC + tanda tangan digital** (digambar di layar, bisa disimpan). Request baru bisa ditandai *Dikirim ke Vendor* setelah ketiganya menyetujui; satu penolakan (dengan alasan) menghentikan request.

**Admin**
- **Generator nomor batch & expired**: admin mengetik batch & expired baru → aplikasi mengunduh PDF asli dari Drive, mengganti teks `BN.xxxx` / `EXP.MM-YYYY` (font Courier New) di posisi, ukuran, warna, dan stroke yang sama, lalu memberi **link download PDF siap cetak**. Bisa dari detail request (per item) atau dari menu *Generator Batch & Exp*.
- **Ringkasan PDF request** untuk vendor: visual sticker, ukuran, jumlah, supplier, batch/exp, **link file mentah Google Drive** + link file siap cetak, dan kotak tanda tangan 3 pihak. Bisa juga dipecah **per supplier**.
- **Laporan PDF** rekap per periode/status.
- **Kelola katalog**: tambah produk baru (nama, kode, detail, link Drive) → langsung tampil di sisi user. Atau tombol **Sinkron dari Google Drive** untuk membaca ulang folder database.
- Kelola pengguna & role.

## Menjalankan

Butuh Node.js 22.5+.

```bash
npm install
npm start
```

Buka http://localhost:3000. Akun awal (segera ganti password di menu *Profil*):

| Username | Password | Role |
|---|---|---|
| admin | admin123 | Admin |
| desainer | ganti123 | Desainer |
| manager | ganti123 | Manager Desain |
| purchasing | ganti123 | Purchasing |
| user | ganti123 | User / tim |

Variabel lingkungan opsional: `PORT`, `DATA_DIR` (database SQLite, thumbnail, file hasil generate), `BASE_URL` (URL publik untuk link di PDF), `ADMIN_PASSWORD`, `DEFAULT_PASSWORD`.

Docker:

```bash
docker build -t request-sticker .
docker run -p 3000:3000 -v sticker-data:/data -e BASE_URL=https://sticker.domainanda.com request-sticker
```

## Database sticker (Google Drive)

Katalog dibaca dari folder Drive `1GsGIB3-t1CGPKtiqNj7ImMG6Xfj3iPPx` (harus dibagikan *Siapa saja yang memiliki link*), tanpa API key. Konvensi yang dibaca:

```
! Brand/                         ← folder brand diawali "!"
  M141. Nama Produk/             ← kode + nama produk
    [subfolder opsional: HALAL, Stiker untuk Box, (Transparan) …]
    M141. Nama - 8,5 x 7 cm.pdf  ← ukuran diambil dari nama file
```

Folder arsip vendor (`1. Vendor - …`) diabaikan. Snapshot awal ada di `seed/drive-tree.json` agar aplikasi langsung jalan; perbarui dengan tombol *Sinkron* atau `npm run sync`.

## Catatan generator batch/exp

- Teks dideteksi otomatis dari pola `BN.` / `BN:` / `No. Batch` dan `EXP.` / `Exp.` / `ED`. Admin cukup mengetik nilainya (tanpa awalan); awalan asli dipertahankan.
- Stroke yang di-expand Illustrator dibersihkan dan diterapkan ulang ke teks baru, jadi tidak ada "bayangan" angka lama. Data edit Illustrator (PieceInfo) yang masih berisi angka lama dibuang dari PDF hasil.
- Uji pada 40 sticker acak: 31 berhasil, 0 rusak; sisanya tidak punya teks batch hidup (sudah di-outline / tidak ada batch) dan aplikasi menampilkan pesan jelas.
- Lihat `fonts/README.md` untuk memakai Courier New asli.

## Tes

```bash
npm test
```
