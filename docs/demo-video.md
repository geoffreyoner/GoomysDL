# GoomysDL Demo Video

Penjelasan animasi 70 detik yang menunjukkan cara kerja GoomysDL dari browser/client sampai file diterima kembali dari server.

File animasi: [`demo-video.html`](./demo-video.html)

## Fungsi web

GoomysDL adalah downloader media publik berbasis web. User menempel URL item publik, memilih format, lalu server yang mengunduh dan menyiapkan file.

- Mendukung video sosial, foto, audio, file host, comic, dan anime dari provider yang terdaftar.
- Menampilkan metadata dan pilihan format sebelum download.
- Menggabungkan hasil multi-file menjadi satu ZIP.
- Membatasi satu job maksimal 500 MB.
- Menjalankan maksimal 2 job secara bersamaan.
- Tidak memerlukan akun.
- Bukan layanan penyimpanan permanen: file dihapus otomatis setelah TTL habis.

## Penjelasan web

| Waktu | Scene | Alur |
|---|---|---|
| 0-4s | Title | URL publik ditempel. Alur utama: `SERVER → CLIENT`. |
| 4-14s | Inspect | Browser mengirim `POST /api/inspect`. Server memvalidasi protokol, host allowlist, dan provider sebelum menyentuh jaringan. URL asing ditolak. |
| 14-27s | Route | Server memilih engine: `yt-dlp` untuk video sosial, `gallery-dl` untuk foto, `scrapr` untuk Spotify, file host, comic, dan anime. Server mengembalikan metadata + format dengan inspectId ber-TTL 15 menit. |
| 27-39s | Queue | User memilih format. Job masuk antrean, maksimal 2 berjalan bersamaan. Progress dan log diambil lewat polling `/api/jobs/:id`. |
| 39-51s | Guard + fetch | Worker mengunduh sambil memeriksa DNS, IP privat/loopback, redirect, dan batas 500 MB. File banyak dibungkus ZIP. |
| 51-61s | Seal | File dienkripsi AES-256-GCM. Server menyimpan dengan nama acak `.enc`; nama untuk user tetap diambil dari metadata. |
| 61-70s | Deliver | Client meminta `GET /api/file/:jobId/:name`. Server mendekripsi sambil streaming. Setelah TTL file habis, file dan job dihapus. |

Detail penting:

- **15 menit** adalah TTL metadata inspect (`INSPECT_TTL`). Ini yang habis di akhir scene Route.
- **10 menit** adalah TTL file hasil download dan job (`FILE_TTL`). Ini yang menghapus file dari server di akhir scene Deliver.
- **Nama di server** acak, contoh `9f2c…a1.enc`.
- **Nama untuk user** dari metadata, contoh `Public Post.zip`.
- **Kunci enkripsi** hanya ada di memori, bukan di disk.
- **Plaintext** dihapus setelah proses seal selesai.

## Privacy

- Tidak ada akun, login, atau profil user.
- Hanya item publik yang didukung; konten privat/login tidak menjadi target.
- URL dan judul hanya diproses di memori selama job berjalan.
- Judul asli tidak ditulis ke disk.
- File disimpan sementara dalam bentuk terenkripsi dengan nama acak.
- File dan job dihapus otomatis setelah 10 menit; metadata inspect dihapus setelah 15 menit.
- Server tetap dapat melihat URL dan metadata saat diproses, dan platform sumber dapat melihat request dari IP server.
- Layanan ini bukan alat anonimitas. Jangan gunakan untuk konten privat atau data sensitif.
- Animasi demo tidak menampilkan URL privat, cookie, atau path server asli.
