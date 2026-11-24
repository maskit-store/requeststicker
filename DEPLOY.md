# Panduan Deploy — Request Cetak Sticker Sainsgo

Aplikasi ini adalah server Node.js yang **menyimpan data di disk** (database SQLite, file PDF siap cetak, font upload).
Karena itu butuh hosting yang **selalu menyala** dan punya **penyimpanan permanen (volume/disk)**.

> ❌ Tidak cocok: Vercel, Netlify, GitHub Pages, Firebase Hosting, shared hosting PHP biasa — data akan hilang / server tidak bisa berjalan terus.

Semua data ada di satu folder (`DATA_DIR`, di Docker = `/data`):

| Isi | Keterangan |
|---|---|
| `app.db` | database: user, katalog, request, tanda tangan, Purchase Request |
| `generated/` | PDF siap cetak hasil ganti batch/expired (link-nya dikirim ke vendor) |
| `fonts/` | font Courier New yang di-upload admin |
| `thumbs/`, `sources/` | cache gambar & PDF dari Drive (boleh hilang) |

## Pengaturan (environment variables)

| Variabel | Wajib | Contoh | Fungsi |
|---|---|---|---|
| `BASE_URL` | ✅ | `https://sticker.sainsgo.com` | alamat publik — dipakai untuk link file di PDF & Purchase Request |
| `ADMIN_PASSWORD` | ✅ (deploy pertama) | password kuat | password akun `admin` saat database pertama kali dibuat |
| `DEFAULT_PASSWORD` | ✅ (deploy pertama) | password kuat | password awal akun `desainer`, `manager`, `purchasing`, `user` |
| `DATA_DIR` | otomatis di Docker | `/data` | lokasi data permanen |
| `PORT` | otomatis | `3000` | port aplikasi |

`ADMIN_PASSWORD` dan `DEFAULT_PASSWORD` hanya dipakai saat database **pertama kali** dibuat. Setelah itu ganti password lewat menu *Profil* / *Pengguna*.

---

## Opsi A — Railway (paling mudah, tanpa urus server) · ± US$5/bulan

1. Buat akun di **railway.com** → *New Project* → *Deploy from GitHub repo* → pilih `maskit-store/requeststicker` (branch yang sudah di-merge).
   Railway otomatis membaca `Dockerfile`.
2. Di service → **Settings → Volumes → Add Volume**, *mount path* = **`/data`** (ini wajib, kalau tidak data hilang setiap deploy).
3. **Variables** → isi `ADMIN_PASSWORD`, `DEFAULT_PASSWORD`, lalu `BASE_URL` (isi setelah langkah 4).
4. **Settings → Networking → Generate Domain** (mis. `requeststicker-production.up.railway.app`) atau *Custom Domain* (mis. `sticker.sainsgo.com`, tambahkan CNAME di pengelola domain).
   Salin alamatnya ke variabel `BASE_URL`, lalu *Redeploy*.
5. **Settings → Deploy → Healthcheck Path** = `/healthz`.
6. Buka alamatnya, login `admin` → lanjut ke *Checklist setelah deploy*.

Render.com (paket berbayar + *Persistent Disk* di `/data`) dan Fly.io (volume di `/data`) bisa dipakai dengan cara yang sama.

## Opsi B — VPS sendiri (Biznet Gio / IDCloudHost / DigitalOcean, dll.) · ± Rp 60–150 rb/bulan

VPS Ubuntu 22.04/24.04, 1 vCPU, 1–2 GB RAM sudah cukup.

```bash
# 1) pasang Docker
curl -fsSL https://get.docker.com | sh

# 2) ambil kode
git clone https://github.com/maskit-store/requeststicker.git /opt/requeststicker
cd /opt/requeststicker

# 3) build & jalankan (data tersimpan di volume "sticker-data")
docker build -t request-sticker .
docker run -d --name request-sticker --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v sticker-data:/data \
  -e BASE_URL=https://sticker.sainsgo.com \
  -e ADMIN_PASSWORD='ganti-dengan-password-kuat' \
  -e DEFAULT_PASSWORD='ganti-dengan-password-kuat' \
  request-sticker
```

**HTTPS + domain dengan Caddy** (sertifikat SSL otomatis). Arahkan DNS `sticker.sainsgo.com` (A record) ke IP VPS, lalu:

```bash
apt install -y caddy
cat > /etc/caddy/Caddyfile <<'EOF'
sticker.sainsgo.com {
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy
```

**Update ke versi terbaru:**

```bash
cd /opt/requeststicker && git pull && docker build -t request-sticker . \
 && docker rm -f request-sticker && docker run -d --name request-sticker --restart unless-stopped \
 -p 127.0.0.1:3000:3000 -v sticker-data:/data -e BASE_URL=https://sticker.sainsgo.com request-sticker
```

## Opsi B2 — Hosting Niagahoster / cPanel dengan Node.js

Lihat **[PANDUAN-NIAGAHOSTER.md](PANDUAN-NIAGAHOSTER.md)** (upload ZIP lewat File Manager, startup file `app.js`, pengaturan lewat `.env`).

## Opsi C — Komputer kantor + Cloudflare Tunnel (gratis)

Cocok bila ada PC/mini-PC kantor yang **menyala 24 jam**. Jalankan dengan Docker (seperti Opsi B) atau Node.js 22 (`npm ci --omit=dev && npm start`),
lalu pasang **Cloudflare Tunnel** (`cloudflared`) agar bisa diakses dari luar kantor lewat domain HTTPS tanpa membuka port router.
Kekurangan: mati listrik / PC dimatikan = aplikasi tidak bisa diakses.

---

## Checklist setelah deploy

1. Login `admin` → **Profil & TTD** → ganti password admin.
2. **Pengguna** → buat akun untuk setiap orang (role *User / Tim* untuk Tim Produksi, Packing, Gudang; *Desainer*; *Purchasing*), lalu **nonaktifkan atau ganti password** akun contoh `desainer`, `manager`, `purchasing`, `user`.
3. **Kelola Katalog → Sinkron dari Google Drive** agar katalog sesuai isi Drive terbaru. Folder database Drive harus tetap dibagikan *"Siapa saja yang memiliki link"*.
4. **Generator Batch & Exp → Font pengganti** → upload `courbd.ttf` (dan `cour.ttf`) dari `C:\Windows\Fonts` agar hasil batch/expired identik Courier New.
5. **Kop Surat & PR** → cek alamat, email, logo.
6. Coba alur lengkap: buat request → ACC Desainer & Purchasing → generate batch → Purchase Request PDF → buka link file di HP lain untuk memastikan `BASE_URL` benar.
7. Minta tiap Desainer & Purchasing membuat tanda tangan di **Profil & TTD**.

## Backup (penting)

Jalankan backup harian — aman saat aplikasi berjalan:

```bash
# Docker (VPS)
docker exec request-sticker node scripts/backup.js /data/backup
# atau tanpa Docker
node scripts/backup.js /lokasi/backup
```

Simpan salinan folder backup di luar server (Google Drive, disk lain). Railway: gunakan fitur *Volume Backups* di dashboard.

**Restore:** hentikan aplikasi → salin `app.db`, `generated/`, `fonts/` dari folder backup ke `DATA_DIR` → jalankan lagi.

## Catatan

- Satu server/instance saja (SQLite tidak untuk dijalankan di beberapa instance sekaligus) — lebih dari cukup untuk tim internal.
- Link "file siap cetak" bersifat publik tapi acak (tidak bisa ditebak) agar bisa dibuka vendor tanpa login. Jangan sebar di grup umum.
- Server perlu akses internet keluar ke `drive.google.com` dan `drive.usercontent.google.com` (thumbnail, unduh PDF, sinkron katalog).
