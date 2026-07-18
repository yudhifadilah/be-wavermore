const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");
const { TranscriptStore } = require("../src/store");

const gzip = promisify(zlib.gzip);

test("filesystem store saves and reads transcript", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "transcript-store-"));
  const store = new TranscriptStore({
    storageProvider: "filesystem",
    storageDir: dir,
    signingSecret: "01234567890123456789012345678901",
    maxUncompressedBytes: 1024 * 1024,
    blobPrefix: "transcripts",
    blobAccess: "private"
  });

  const document = {
    version: 1,
    ticket_id: "ticket",
    channel_id: "channel",
    channel_name: "ticket-channel",
    closed_at: new Date().toISOString(),
    messages: []
  };
  const payload = await gzip(Buffer.from(JSON.stringify(document), "utf8"));
  const { metadata } = await store.save(payload, "uaid_test_123", new Date(Date.now() + 7 * 60 * 60 * 1000));

  assert.equal(metadata.id.length, 64);
  const loaded = await store.read(metadata.id);
  assert.equal(loaded.document.ticket_id, "ticket");
  assert.deepEqual(loaded.gzipPayload, payload);
});
