# Wevermore Transcript Backend

Backend Node.js Express untuk menerima transcript gzip dari bot, memverifikasi upload signature, menyimpan transcript, lalu membuat URL publik yang memiliki `uaid`, `exp`, dan `sig`.

Project ini sudah disiapkan untuk deploy ke Vercel. Untuk production, gunakan Vercel Blob supaya transcript tetap tersimpan selama URL masih aktif.

## Endpoint

- `POST /api/v1/transcripts` - upload transcript dari bot, body wajib gzip.
- `GET /api/v1/transcripts/:id` - data JSON transcript untuk frontend.
- `GET /api/v1/transcripts/:id/download?format=html` - download HTML.
- `GET /api/v1/transcripts/:id/download?format=gzip` - download JSON.GZ asli.
- `GET /healthz` - health check.

## Environment Variables

Copy `.env.example` menjadi `.env` untuk lokal.

```bash
cp .env.example .env
```

Wajib diisi:

- `TRANSCRIPT_UPLOAD_SECRET` harus sama dengan secret upload pada bot.
- `TRANSCRIPT_SIGNING_SECRET` minimal 32 karakter.
- `BACKEND_PUBLIC_URL` isi dengan URL backend Vercel.
- `FRONTEND_PUBLIC_URL` isi dengan URL frontend transcript.
- `CORS_ALLOWED_ORIGIN` isi dengan URL frontend, atau `*` jika benar-benar diperlukan.
- `BLOB_READ_WRITE_TOKEN` isi dari Vercel Blob Storage.

## Deploy ke Vercel

1. Buat project baru di Vercel dari folder ini.
2. Tambahkan Vercel Blob Storage ke project.
3. Isi semua environment variable sesuai `.env.example`.
4. Deploy.

`vercel.json` sudah mengarahkan semua request ke `api/index.js`, jadi endpoint lama tetap sama.

## Menjalankan Lokal

```bash
npm install
npm test
npm run dev
```

Jika `BLOB_READ_WRITE_TOKEN` kosong dan `TRANSCRIPT_STORAGE_PROVIDER=filesystem`, transcript lokal disimpan ke `TRANSCRIPT_STORAGE_DIR`.

## Signature Upload dari Bot

Backend tetap kompatibel dengan format lama:

```text
HMAC_SHA256(TRANSCRIPT_UPLOAD_SECRET, timestamp + "\n" + uaid + "\n" + sha256(gzip_body))
```

Header yang wajib dikirim bot:

- `Content-Encoding: gzip`
- `X-Fyneeds-Timestamp`
- `X-Fyneeds-UAID`
- `X-Fyneeds-Signature`

URL public transcript memakai:

```text
HMAC_SHA256(TRANSCRIPT_SIGNING_SECRET, id + "." + uaid + "." + exp)
```
