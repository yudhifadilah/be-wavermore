const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { del, get, list, put } = require("@vercel/blob");
const { gunzipLimited } = require("./gzip");

const idPattern = /^[a-f0-9]{64}$/;

class NotFoundError extends Error {
  constructor(message = "transcript tidak ditemukan") {
    super(message);
    this.code = "ENOENT";
  }
}

class TranscriptStore {
  constructor(cfg) {
    this.cfg = cfg;
    this.provider = cfg.storageProvider;
    this.dir = cfg.storageDir;
    this.hashSalt = cfg.signingSecret;
    this.maxUncompressedBytes = cfg.maxUncompressedBytes;
    this.blobPrefix = cfg.blobPrefix || "transcripts";
    this.blobAccess = cfg.blobAccess || "private";
    this.ready = this.provider === "filesystem" ? fs.mkdir(this.dir, { recursive: true }) : Promise.resolve();
  }

  async save(gzipPayload, uaid, expiresAt) {
    await this.ready;
    const document = await this.decodeDocument(gzipPayload);
    if (!document.ticket_id || !document.channel_id) {
      throw new Error("metadata ticket transcript tidak lengkap");
    }
    if (!uaid) {
      throw new Error("UAID kosong");
    }

    const id = this.newHashedID(document.ticket_id, uaid);
    const metadata = {
      id,
      uaid,
      ticket_id: document.ticket_id,
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      gzip_bytes: gzipPayload.length
    };
    const metaPayload = Buffer.from(JSON.stringify(metadata), "utf8");

    if (this.provider === "vercel-blob") {
      await this.writeBlob(this.gzipPath(id), gzipPayload, "application/gzip");
      await this.writeBlob(this.metaPath(id), metaPayload, "application/json; charset=utf-8");
    } else {
      await this.writeAtomic(this.gzipPath(id), gzipPayload);
      await this.writeAtomic(this.metaPath(id), metaPayload);
    }

    return { metadata, document };
  }

  async read(id) {
    await this.ready;
    if (!idPattern.test(id)) {
      throw new NotFoundError();
    }

    const metaPayload = await this.readBytes(this.metaPath(id));
    const metadata = JSON.parse(metaPayload.toString("utf8"));
    const gzipPayload = await this.readBytes(this.gzipPath(id));
    const document = await this.decodeDocument(gzipPayload);
    return { metadata, document, gzipPayload };
  }

  async cleanupExpired(now = new Date()) {
    await this.ready;
    if (this.provider === "vercel-blob") {
      return this.cleanupExpiredBlobs(now);
    }
    return this.cleanupExpiredFiles(now);
  }

  async decodeDocument(payload) {
    let plain;
    try {
      plain = await gunzipLimited(payload, this.maxUncompressedBytes);
    } catch (error) {
      if (error.message === "transcript hasil dekompresi melebihi batas") {
        throw error;
      }
      throw new Error(`payload bukan gzip valid: ${error.message}`);
    }

    let document;
    try {
      document = JSON.parse(plain.toString("utf8"));
    } catch (error) {
      throw new Error(`decode transcript JSON: ${error.message}`);
    }
    if (document.version !== 1) {
      throw new Error(`versi transcript ${document.version} tidak didukung`);
    }
    return document;
  }

  newHashedID(ticketID, uaid) {
    const random = crypto.randomBytes(32);
    return crypto
      .createHash("sha256")
      .update("fyneeds-transcript-v1\n")
      .update(ticketID)
      .update(`\n${uaid}\n${this.hashSalt}\n`)
      .update(random)
      .digest("hex");
  }

  gzipPath(id) {
    return this.provider === "vercel-blob"
      ? `${this.blobPrefix}/${id}.json.gz`
      : path.join(this.dir, `${id}.json.gz`);
  }

  metaPath(id) {
    return this.provider === "vercel-blob"
      ? `${this.blobPrefix}/${id}.meta.json`
      : path.join(this.dir, `${id}.meta.json`);
  }

  async writeAtomic(filePath, payload) {
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(temporary, payload, { mode: 0o600 });
    await fs.rename(temporary, filePath);
  }

  async readBytes(filePath) {
    if (this.provider === "vercel-blob") {
      const result = await get(filePath, {
        access: this.blobAccess,
        useCache: false
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new NotFoundError();
      }
      return streamToBuffer(Readable.fromWeb(result.stream));
    }

    try {
      return await fs.readFile(filePath);
    } catch (error) {
      if (error && error.code === "ENOENT") throw new NotFoundError();
      throw error;
    }
  }

  async writeBlob(pathname, payload, contentType) {
    await put(pathname, payload, {
      access: this.blobAccess,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType
    });
  }

  async cleanupExpiredFiles(now) {
    const entries = await fs.readdir(this.dir).catch((error) => {
      if (error && error.code === "ENOENT") return [];
      throw error;
    });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.endsWith(".meta.json")) continue;
      const id = entry.slice(0, -".meta.json".length);
      if (!idPattern.test(id)) continue;
      try {
        const metadata = JSON.parse(
          await fs.readFile(path.join(this.dir, entry), "utf8")
        );
        if (new Date(metadata.expires_at).getTime() > now.getTime()) continue;
        await Promise.allSettled([
          fs.unlink(this.metaPath(id)),
          fs.unlink(this.gzipPath(id))
        ]);
        removed += 1;
      } catch {
        // Abaikan file metadata rusak agar cleanup tidak menghentikan request.
      }
    }
    return removed;
  }

  async cleanupExpiredBlobs(now) {
    let cursor;
    let removed = 0;
    do {
      const page = await list({ prefix: `${this.blobPrefix}/`, limit: 1000, cursor });
      const metas = page.blobs.filter((blob) => blob.pathname.endsWith(".meta.json"));
      for (const blob of metas) {
        const id = path.basename(blob.pathname, ".meta.json");
        if (!idPattern.test(id)) continue;
        try {
          const metadataPayload = await this.readBytes(blob.pathname);
          const metadata = JSON.parse(metadataPayload.toString("utf8"));
          if (new Date(metadata.expires_at).getTime() > now.getTime()) continue;
          await del([this.metaPath(id), this.gzipPath(id)]);
          removed += 1;
        } catch {
          // Blob bisa sudah terhapus oleh request lain; aman untuk dilewati.
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return removed;
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = { NotFoundError, TranscriptStore, idPattern };
