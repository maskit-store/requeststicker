# Menghubungkan aplikasi ke Google Sheet "Numerik Sticker"

Aplikasi **membaca** Google Sheet secara otomatis (sheet sudah bisa dibuka lewat link), untuk:

- Kode SKU tiap produk (tab **KODE SKU**), dipakai di nomor batch.
- Nomor batch yang sudah terbit (tab **Nomor Batch**), supaya urutan produksi tidak bentrok.
- Kode Numerik terakhir per brand (tab Maskit, Wonderpaw, Twinbi, dst.), supaya kode produk baru melanjutkan nomor terakhir.

Supaya aplikasi juga bisa **menulis** ke sheet, pasang Apps Script sekali saja (±5 menit):

| Kejadian di aplikasi | Yang ditulis ke sheet |
| --- | --- |
| Admin menambah produk baru | Satu baris baru di tab brand (Nama, Ukuran, Volume, **Kode Numerik**) dan satu baris baru di tab **KODE SKU** |
| Desainer membuat file siap cetak | Satu baris baru di tab **Nomor Batch**: Merek, Produk, Volume, `BN.xxxxxx` / `EXP.xx-xxxx`, Jumlah, Supplier |

Script hanya **menambah baris di bawah data terakhir**. Baris yang sudah ada tidak pernah diubah atau dihapus.

## Langkah

1. Buka Google Sheet **Numerik Sticker** dengan akun pemilik sheet.
2. Klik menu **Ekstensi → Apps Script**.
3. Hapus isi `Code.gs` yang ada, lalu tempel seluruh isi file `google-apps-script/Code.gs` dari paket aplikasi.
4. Di baris `const TOKEN = '...'`, ganti isinya dengan kata sandi acak buatan Anda, misalnya `sgo-7Kq2-pX91-batch`. Klik ikon **Simpan**.
5. Klik **Terapkan → Penerapan baru**.
   - Ikon roda gigi → **Aplikasi web**
   - Jalankan sebagai: **Saya**
   - Yang memiliki akses: **Siapa saja**
   - Klik **Terapkan**, lalu **Izinkan akses**. Jika muncul peringatan "Google belum memverifikasi aplikasi ini", klik **Lanjutan → Buka (tidak aman)**. Script ini milik Anda sendiri.
6. Salin **URL aplikasi web** (berakhiran `/exec`).
7. Di aplikasi Request Sticker, login sebagai admin dan buka **Kop Surat & PR → Koneksi Google Sheet**.
   - Tempel URL Web App.
   - Isi token yang sama dengan langkah 4.
   - Klik **Simpan**, lalu **Tes koneksi**. Jika berhasil, akan muncul nama spreadsheet.

Jika koneksi sempat terputus, penulisan ke sheet disimpan dulu di antrean. Klik **Kirim ulang antrean** untuk mengirimnya lagi.

## Aturan penomoran (POB/KO/PD/001.01)

- **Nomor batch** = `MM` (bulan produksi) + `YY` (tahun produksi) + `NN` (produksi ke-berapa di bulan itu) + `SKU` (3 karakter).
  Contoh: produksi ke-2 bulan April 2026 untuk produk A01 → `042602A01`.
- **Expired** = bulan produksi + masa simpan (bulan) + **1 bulan cadangan**, dengan format `MM-YYYY`.
  Contoh: produksi November 2026 dengan masa simpan 36 bulan → `12-2029`.
- Desainer cukup mengisi **tanggal produksi** dan **masa simpan (bulan)**.
  - **Urutan produksi** disarankan otomatis: nomor terakhir bulan itu (dari aplikasi dan tab Nomor Batch) + 1. Item lain dalam request yang sama memakai urutan yang sama.
  - **Kode SKU** diambil dari tab KODE SKU.
- Produk varian (beda ukuran, sachet, atau pouch) memakai Kode SKU induknya, sesuai sel yang digabung (merge) di tab KODE SKU.
