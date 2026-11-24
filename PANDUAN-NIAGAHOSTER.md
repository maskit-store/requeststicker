# Panduan Upload ke Niagahoster — sticker.sainsgo.com

Aplikasi ini adalah **aplikasi Node.js** (bukan website HTML/PHP). Jadi tidak cukup hanya di-upload ke `public_html`:
paket hosting harus punya fitur **Node.js**:

- **cPanel** → menu **"Setup Node.js App"** (bagian *Software*), atau
- **hPanel** (panel Niagahoster/Hostinger terbaru) → **Websites → Node.js** / *Node.js Web Apps*.

Kalau menu itu **tidak ada** di paket Anda, lihat bagian *"Jika paket tidak mendukung Node.js"* di bawah.

Syarat versi: **Node.js 22** (22.13 ke atas) atau **24**.

---

## A. cPanel — "Setup Node.js App"

1. **Buat subdomain** (kalau belum): cPanel → *Domains / Subdomains* → `sticker` . `sainsgo.com`.
2. **Upload file**: cPanel → *File Manager* → buka folder home (`/home/USERNAME/`, **bukan** `public_html`) →
   *+ Folder* → buat folder **`sticker-app`** → masuk ke folder itu → *Upload* `requeststicker-hosting.zip` → klik kanan → *Extract*.
   Pastikan `app.js`, `package.json`, folder `src`, `public`, dll. langsung berada di dalam `sticker-app/`.
3. **Buat folder data** (tempat database & file cetak, agar tidak terhapus saat upload ulang): di `/home/USERNAME/` buat folder **`sticker-data`**.
4. **Isi pengaturan**: di `sticker-app/`, salin `.env.example` → ubah nama menjadi **`.env`** → *Edit*:
   ```
   BASE_URL=https://sticker.sainsgo.com
   ADMIN_PASSWORD=password-admin-yang-kuat
   DEFAULT_PASSWORD=password-awal-tim-yang-kuat
   DATA_DIR=/home/USERNAME/sticker-data
   ```
   (ganti `USERNAME` dengan username cPanel Anda — terlihat di File Manager / pojok kanan cPanel.)
   > File berawalan titik tersembunyi? File Manager → *Settings* → centang *Show Hidden Files (dotfiles)*.
5. cPanel → **Setup Node.js App** → **Create Application**:
   | Isian | Nilai |
   |---|---|
   | Node.js version | **22.x** (atau 24.x) |
   | Application mode | Production |
   | Application root | `sticker-app` |
   | Application URL | `sticker.sainsgo.com` |
   | Application startup file | **`app.js`** |
   Klik **Create**.
6. Di halaman aplikasi tadi klik **Run NPM Install** (tunggu sampai selesai), lalu **Restart**.
7. **HTTPS**: cPanel → *SSL/TLS Status* (AutoSSL) → pastikan `sticker.sainsgo.com` punya sertifikat (biasanya otomatis).
8. Buka **https://sticker.sainsgo.com** → login `admin` dengan `ADMIN_PASSWORD`.

## B. hPanel — Node.js Web Apps

1. hPanel → **Websites** → **Add website / Node.js App** (nama menu bisa sedikit berbeda) → pilih **Upload files** → upload `requeststicker-hosting.zip`.
2. Domain: pilih / tambahkan **sticker.sainsgo.com**.
3. Build settings: Node.js **22** (atau 24) · *Install command* `npm install` · *Start command* `npm start` (atau *entry file* `app.js`).
4. **Environment variables** (di halaman pengaturan aplikasi): isi `BASE_URL`, `ADMIN_PASSWORD`, `DEFAULT_PASSWORD`, dan
   `DATA_DIR` = folder di luar folder aplikasi (cek path home Anda di File Manager, mis. `/home/u123456789/sticker-data`).
5. Deploy → buka **https://sticker.sainsgo.com**.

---

## Setelah online (wajib)

1. Login `admin` → **Profil & TTD** → ganti password.
2. **Pengguna** → buat akun tiap anggota tim; ganti password / nonaktifkan akun contoh `desainer`, `manager`, `purchasing`, `user`.
3. **Kelola Katalog → Sinkron dari Google Drive**.
4. **Generator Batch & Exp → Font pengganti** → upload `courbd.ttf` & `cour.ttf` dari `C:\Windows\Fonts`.
5. Desainer & Purchasing membuat tanda tangan di **Profil & TTD**.
6. Coba 1 alur penuh, lalu buka link "file siap cetak" dari HP untuk memastikan `BASE_URL` benar.

## Update versi baru

Upload ZIP baru ke `sticker-app/` → *Extract* (timpa) → **Run NPM Install** → **Restart**.
Data aman karena tersimpan di `sticker-data/` (asalkan `DATA_DIR` sudah diisi). File `.env` tidak ikut tertimpa karena ZIP hanya berisi `.env.example`.

## Backup

Download folder **`sticker-data`** (klik kanan → *Compress* → *Download*) secara rutin, minimal seminggu sekali.
Atau via *Terminal* cPanel: `cd ~/sticker-app && node scripts/backup.js ~/sticker-backup`.

## Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| Error "node_modules … should not contain folder" | Hapus folder `node_modules` di `sticker-app/`, lalu *Run NPM Install*. |
| "membutuhkan Node.js versi 22.13" / "node:sqlite tidak tersedia" | Pilih Node.js 22 terbaru atau 24. Jika hanya ada 22.5–22.12, tambahkan variabel `NODE_OPTIONS=--experimental-sqlite`. |
| Halaman 503 / aplikasi tidak jalan | Setup Node.js App → *Restart*; cek file `stderr.log` di `sticker-app/`. |
| Data hilang setelah upload ulang | `DATA_DIR` belum diisi → data tersimpan di `sticker-app/data`. Isi `DATA_DIR` dan pindahkan isi folder `data` ke sana. |
| Gambar sticker tidak muncul | Folder Drive harus dibagikan "Siapa saja yang memiliki link"; server harus bisa mengakses internet keluar. |

## Jika paket tidak mendukung Node.js

Paket shared hosting biasa (hanya PHP) **tidak bisa** menjalankan aplikasi ini. Pilihan:

1. **Upgrade paket** Niagahoster ke yang mendukung Node.js (tanyakan ke CS: "apakah paket saya bisa Setup Node.js App / Node.js 22?").
2. **Tetap pakai subdomain `sticker.sainsgo.com`**, tapi aplikasinya dijalankan di Railway / VPS (lihat `DEPLOY.md`),
   lalu di **DNS Zone Editor** Niagahoster tambahkan record:
   - Railway: `CNAME` `sticker` → alamat yang diberikan Railway (mis. `xxxx.up.railway.app`)
   - VPS: `A` `sticker` → IP VPS
