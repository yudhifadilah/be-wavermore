# Fyneeds Transcript Backend

Backend Golang tanpa Docker untuk menerima transcript gzip dari bot, menyimpan file secara persistent, memverifikasi signature upload, dan menerbitkan URL publik yang kedaluwarsa.

## Keamanan URL

- ID publik berupa SHA-256 hash 64 karakter dan tidak memakai nomor channel sebagai path publik.
- Setiap URL membawa `uaid`, `exp`, dan `sig`.
- `sig` adalah HMAC-SHA256 atas `id.uaid.exp`, sehingga UAID tidak dapat diganti tanpa membuat signature tidak valid.
- Masa berlaku default adalah 7 jam.
- Upload bot memakai HMAC-SHA256 terpisah atas `timestamp`, `uaid`, dan SHA-256 payload gzip.
- Backend membatasi ukuran terkompresi dan hasil dekompresi.

## Endpoint

- `POST /api/v1/transcripts` — khusus bot, body wajib gzip.
- `GET /api/v1/transcripts/{hash}` — data JSON untuk frontend dengan signed query.
- `GET /api/v1/transcripts/{hash}/download?format=html` — download HTML.
- `GET /api/v1/transcripts/{hash}/download?format=gzip` — download JSON.GZ asli.
- `GET /healthz` — health check.

## Menjalankan

```bash
cp .env.example .env
go test ./...
go build -trimpath -ldflags="-s -w" -o fyneeds-transcript-backend ./cmd/server
./fyneeds-transcript-backend
```

Pastikan `TRANSCRIPT_STORAGE_DIR` menggunakan volume atau disk persistent pada penyedia hosting. Backend menghapus file kedaluwarsa secara berkala.
