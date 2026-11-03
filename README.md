# Marathon Membership Overlay (YouTube)

Overlay OBS untuk livestream marathon: timer hitung mundur yang **bertambah otomatis** setiap ada member YouTube join (durasi per tier bisa diatur), plus overlay **milestone** jumlah member dengan progress bar.

- Member baru, upgrade, dan **gift membership** (gift 5 = 5× durasi tier) terdeteksi otomatis dari live chat YouTube, tanpa kuota (YouTube Data API resmi tersedia sebagai cadangan).
- Animasi event `+5:00 · nama · member baru (Tier)` di overlay timer.
- Control panel: start/pause, tambah/kurang waktu, ubah jumlah member, simulasi event, edit tier & milestone.
- State tersimpan di `data/state.json` — aman kalau server/OBS restart.

## Persiapan: Node.js

Proyek ini butuh **Node.js versi 18 atau lebih baru** (disarankan versi LTS terbaru).

### Cek apakah Node.js sudah terpasang

Buka terminal (Windows: **PowerShell** atau **Command Prompt**; macOS/Linux: **Terminal**), lalu jalankan:

```bash
node -v
```

```bash
npm -v
```

- Muncul versi seperti `v22.16.0` dan `10.9.2` → Node.js sudah terpasang. Pastikan angka pertama versi node **18 atau lebih**, lalu lanjut ke [Menjalankan](#menjalankan).
- Muncul error seperti `'node' is not recognized…` / `command not found: node`, atau versinya di bawah 18 → pasang Node.js dulu (langkah di bawah).

### Cara install Node.js

**Windows**

- Cara termudah: buka <https://nodejs.org>, unduh versi **LTS** (Windows Installer `.msi`), jalankan, lalu klik *Next* sampai selesai (biarkan opsi default, termasuk *Add to PATH*).
- Atau lewat terminal dengan winget (sudah ada di Windows 10/11):

  ```bash
  winget install OpenJS.NodeJS.LTS
  ```

**macOS**

- Unduh installer **LTS** (`.pkg`) dari <https://nodejs.org>, atau dengan Homebrew:

  ```bash
  brew install node
  ```

**Linux**

- Paling aman lewat [nvm](https://github.com/nvm-sh/nvm):

  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  ```

  Tutup dan buka lagi terminal, lalu:

  ```bash
  nvm install --lts
  ```

Setelah install, **tutup lalu buka lagi terminal**, kemudian ulangi `node -v` dan `npm -v` untuk memastikan berhasil.

### Masalah umum

- **`node` masih tidak dikenali setelah install** → tutup semua jendela terminal/VS Code lalu buka lagi; kalau masih, restart PC agar PATH ter-update.
- **PowerShell: `npm.ps1 cannot be loaded because running scripts is disabled`** → jalankan sekali:

  ```bash
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

  atau pakai Command Prompt, atau ketik `npm.cmd` sebagai ganti `npm`.

## Menjalankan

Buka terminal di folder proyek ini (Windows: buka folder di File Explorer → klik kanan → *Open in Terminal*), lalu:

```bash
npm install
```

```bash
npm start
```

`npm install` cukup sekali (atau setelah update proyek). Selanjutnya cukup `npm start`. Biarkan terminal tetap terbuka selama live; tutup terminal (atau tekan `Ctrl+C`) untuk mematikan server.

Buka control panel: <http://localhost:3000/control.html>

## Pasang di OBS

Tambahkan **Browser Source** (centang *Shutdown source when not visible* = off):

| Overlay   | URL                                          | Ukuran saran |
|-----------|----------------------------------------------|--------------|
| Timer     | `http://localhost:3000/overlay-timer.html`     | 900 × 300    |
| Milestone | `http://localhost:3000/overlay-milestone.html` | 700 × 200    |

Background sudah transparan. Opsi tampilan lewat URL, contoh:

```
http://localhost:3000/overlay-timer.html?label=SUBATHON&accent=%2300d1ff&size=110
```

| Parameter | Overlay   | Fungsi                                   |
|-----------|-----------|------------------------------------------|
| `lang`    | keduanya  | `en` atau `id`, menimpa **Pengaturan → Bahasa overlay** |
| `list`    | milestone | `list=0` untuk menyembunyikan daftar milestone |
| `label`   | timer     | Menimpa judul dari control panel (`label=` kosong = sembunyikan) |
| `caps`    | timer     | Teks di bawah angka, mis. `caps=JAM,MENIT,DETIK`; `caps=` kosong = sembunyikan |
| `alerts`  | timer     | `alerts=0` untuk mematikan animasi event  |
| `alertMs` | timer     | Lama event tampil menggantikan timer (ms), default 5000 |
| `size`    | timer     | Ukuran angka timer dalam px (default 96)  |
| `unit`    | milestone | Satuan, mis. `unit=Gift%20Member` (default `Member`) |
| `reward`  | milestone | `reward=0` untuk menyembunyikan bonus menit (ikon piala) |
| `width`   | milestone | Lebar kartu dalam px (default 420)        |
| `bg`      | milestone | Warna kartu, mis. `rgba(0,0,0,0.6)`       |
| `color`   | keduanya  | Warna teks (`%23` = `#`)                  |
| `accent`  | milestone | Warna isi progress bar                    |
| `font`    | keduanya  | Nama font yang terpasang di PC (default Poppins) |

Judul timer (default `MARATHON`) diatur di **control panel → Pengaturan → Judul timer**; kosongkan untuk menyembunyikan. Saat ada event, angka timer disembunyikan sementara dan diganti `+10:00 / nama / jenis event`, lalu timer muncul lagi.

**Bahasa:** teks overlay (Hours/Jam, PAUSED/JEDA, "remaining to achieve", dst.) bisa English atau Indonesia lewat **Pengaturan → Bahasa overlay** (default English). Bahasa control panel (default English) dipilih terpisah di pojok kanan atas dan diingat per browser. Teks dari server (pesan error) tetap Bahasa Indonesia.

Judul kartu milestone = label milestone yang sedang dikejar. Kalau ada lebih dari 1 milestone, daftar semua milestone tampil di atasnya dengan centang untuk yang sudah tercapai. **Bonus menit** per milestone (ikon piala) otomatis ditambahkan ke timer saat milestone tercapai karena member join/gift.

Untuk desain lebih lanjut, edit `public/css/overlay.css`.

## Menghubungkan ke YouTube (default: tanpa kuota, tanpa setup)

Sumber default adalah **Live chat langsung**: server membaca live chat YouTube dengan cara yang sama seperti halaman chat di browser. Tidak perlu Google Cloud, login, atau API key, dan **tidak ada kuota**. Chat dicek tiap ±3–5 detik.

1. Control panel → **Pengaturan → Channel YouTube**, isi `@channelkamu` → Simpan.
2. Setelah mulai live, klik **Connect** (kolom Video ID boleh kosong). Bisa juga mengisi Video ID / URL live secara langsung.
3. Status berubah jadi "Terhubung ke live chat". Member yang join **setelah** Connect akan dihitung.

Catatan:
- Ini **cara tidak resmi**. Kalau YouTube mengubah format chat, deteksi bisa berhenti bekerja. Event membership mentah disimpan di `data/raw-events.log` untuk membantu memperbaikinya. Kalau bermasalah, ganti **Sumber** ke "YouTube API resmi".
- Chat YouTube tidak menyebut tier yang di-gift, jadi gift memakai **Pengaturan → Tier untuk gift membership** (default: tier pertama).
- Tier member baru dibaca dari teks "Welcome to *Tier*!". Untuk channel dengan satu tier, YouTube hanya menulis "New member", sehingga dipakai nilai "Tier tidak dikenal".
- Kalau koneksi internet putus sebentar, server mencoba lagi otomatis tiap 10 detik.

## Opsional: Setup YouTube API resmi

Pakai ini hanya kalau mode Live chat langsung bermasalah. Pilih **Sumber → YouTube API resmi** di control panel.

1. Buka <https://console.cloud.google.com/> → buat project baru.
2. **APIs & Services → Library** → aktifkan **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen** → User type *External*, isi nama app & email. Di bagian **Test users**, tambahkan email Google akun channel YouTube kamu.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/oauth2callback`
5. Download JSON-nya, simpan sebagai `credentials.json` di folder proyek ini (sejajar `server.js`).
6. Restart server, buka control panel → **Login YouTube** → pilih akun channel (kalau ada peringatan "Google hasn't verified this app", klik *Continue*: itu app milikmu sendiri).
7. Saat sudah live → klik **Connect**. Kosongkan Video ID untuk otomatis memakai siaran live aktif di channel kamu.

Token disimpan di `data/token.json`, jadi lain kali cukup klik Connect.

> ⚠️ Jangan bagikan `credentials.json` dan folder `data/`.

## Kuota YouTube API (hanya untuk mode API resmi)

Kuota default **10.000 unit/hari** dan setiap pengecekan chat ≈ 5 unit.

| Interval polling | Unit/jam | Kuota default cukup |
|------------------|----------|---------------------|
| 20 detik         | 900      | ±11 jam             |
| 30 detik         | 600      | ±16 jam             |
| 45 detik         | 400      | ±25 jam             |

Atur di **Pengaturan → Interval polling**. Interval panjang **tidak membuat event hilang**, hanya muncul sedikit terlambat. Kuota reset tiap tengah malam waktu Pasifik (± jam 14:00–15:00 WIB). Untuk marathon multi-hari, ajukan kenaikan kuota di Google Cloud Console (*IAM & Admin → Quotas*).

Kalau kuota habis, timer tetap jalan; kamu bisa menambah waktu/member secara manual dari control panel.

## Cara kerja hitungan

| Event YouTube                | Waktu                         | Jumlah member |
|------------------------------|-------------------------------|---------------|
| Member baru                  | + durasi tier                 | +1            |
| Gift N membership            | + N × durasi tier yang di-gift | +N            |
| Upgrade tier                 | + durasi tier baru (bisa dimatikan) | tidak berubah |
| Perpanjang (milestone chat)  | + nilai "Perpanjang member" (default 0) | tidak berubah |

- Nama tier di pengaturan harus **sama persis** (huruf besar/kecil bebas) dengan nama level membership di YouTube Studio. Tier yang tidak dikenali memakai nilai "Tier tidak dikenal".
- Event yang terjadi **sebelum** klik Connect tidak dihitung.
- Event member tetap menambah waktu walau timer sedang pause.
- Saat timer habis, timer berhenti di 00:00:00 ("SELESAI"). Event setelahnya tetap menambah waktu, dan kamu bisa klik Start lagi bila ingin lanjut.

## Tes tanpa live

Di control panel, bagian **Simulasi**: pilih jenis event & tier → **Kirim event tes**. Simulasi memakai format data yang sama dengan YouTube API, jadi alur hitungannya identik dengan saat live. Event tes ditandai "TES" di log. Pakai **Reset marathon** sebelum mulai live sungguhan.

## OBS di PC lain

Jalankan dengan `HOST=0.0.0.0` lalu pakai IP PC server di URL overlay. Catatan: control panel tidak memakai password, jadi lakukan ini hanya di jaringan rumah yang kamu percaya.
