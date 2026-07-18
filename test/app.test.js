const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-app-default-"));
process.env.TRANSCRIPT_UPLOAD_SECRET = "abcdefghijklmnopqrstuvwxyz123456";
process.env.TRANSCRIPT_SIGNING_SECRET = "01234567890123456789012345678901";
process.env.BACKEND_PUBLIC_URL = "http://127.0.0.1:3000";
process.env.FRONTEND_PUBLIC_URL = "http://127.0.0.1:3001";
process.env.TRANSCRIPT_STORAGE_PROVIDER = "filesystem";
process.env.TRANSCRIPT_STORAGE_DIR = defaultDir;

const { createApp } = require("../src/app");
const { sha256Hex, uploadSignature } = require("../src/security");

const gzip = promisify(zlib.gzip);

test("upload creates signed URLs and download returns original gzip", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-app-"));
  const cfg = {
    host: "127.0.0.1",
    port: 0,
    uploadSecret: "abcdefghijklmnopqrstuvwxyz123456",
    signingSecret: "01234567890123456789012345678901",
    publicBackendURL: "http://127.0.0.1:3000",
    frontendURL: "http://127.0.0.1:3001",
    allowedOrigin: "http://127.0.0.1:3001",
    expiryHours: 7,
    uploadClockSkewSeconds: 300,
    maxCompressedBytes: 25 * 1024 * 1024,
    maxUncompressedBytes: 100 * 1024 * 1024,
    storageProvider: "filesystem",
    storageDir: dir,
    blobPrefix: "transcripts",
    blobAccess: "private"
  };
  const app = createApp({ config: cfg });
  const server = app.listen(0);
  t.after(() => server.close());
  const baseURL = `http://127.0.0.1:${server.address().port}`;

  const document = {
    version: 1,
    shop_name: "Wevermore",
    ticket_id: "ticket-123",
    guild_id: "guild",
    channel_id: "channel",
    channel_name: "instant-user-1",
    buyer_id: "buyer",
    buyer_username: "buyer_name",
    category: "robux instant",
    created_at: new Date().toISOString(),
    closed_at: new Date().toISOString(),
    amount: 100000,
    message_count: 0,
    truncated: false,
    messages: []
  };
  const payload = await gzip(Buffer.from(JSON.stringify(document), "utf8"));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const uaid = "uaid_test_123";
  const signature = uploadSignature(cfg.uploadSecret, timestamp, uaid, sha256Hex(payload));

  const upload = await fetch(`${baseURL}/api/v1/transcripts`, {
    method: "POST",
    headers: {
      "Content-Encoding": "gzip",
      "Content-Type": "application/json",
      "X-Fyneeds-Timestamp": timestamp,
      "X-Fyneeds-UAID": uaid,
      "X-Fyneeds-Signature": signature
    },
    body: payload
  });
  assert.equal(upload.status, 201);
  const receipt = await upload.json();
  assert.equal(receipt.uaid, uaid);
  assert.match(receipt.id, /^[a-f0-9]{64}$/);
  assert.match(receipt.view_url, /\/transcript\/[a-f0-9]{64}\?/);

  const downloadURL = new URL(receipt.download_gzip_url);
  const download = await fetch(`${baseURL}${downloadURL.pathname}${downloadURL.search}`);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload);
});
