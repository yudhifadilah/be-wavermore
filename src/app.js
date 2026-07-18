const express = require("express");
const { loadConfig } = require("./config");
const { renderHTML } = require("./html");
const {
  publicSignature,
  sha256Hex,
  verifyPublic,
  verifyUpload
} = require("./security");
const { NotFoundError, TranscriptStore, idPattern } = require("./store");

function createApp(options = {}) {
  const cfg = options.config || loadConfig();
  const store = options.store || new TranscriptStore(cfg);
  const app = express();
  app.locals.config = cfg;
  app.locals.store = store;

  app.use(securityHeaders);
  app.use(cors(cfg));

  app.get("/healthz", async (_req, res) => {
    cleanupInBackground(store);
    writeJSON(res, 200, { status: "ok", service: "wevermore-transcript-backend" });
  });

  app.post(
    "/api/v1/transcripts",
    requireGzipBody,
    rawBody(cfg.maxCompressedBytes + 1),
    async (req, res) => {
      const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (payload.length > cfg.maxCompressedBytes) {
        return writeError(res, 413, "payload gzip terlalu besar");
      }

      const timestamp = String(req.get("X-Fyneeds-Timestamp") || "").trim();
      const uaid = String(req.get("X-Fyneeds-UAID") || "").trim();
      const providedSignature = String(req.get("X-Fyneeds-Signature") || "").trim();
      const bodyHash = sha256Hex(payload);
      const valid = verifyUpload(
        cfg.uploadSecret,
        timestamp,
        uaid,
        bodyHash,
        providedSignature,
        new Date(),
        cfg.uploadClockSkewSeconds
      );
      if (!valid) {
        return writeError(res, 401, "signature upload tidak valid");
      }
      if (uaid.length < 12 || uaid.length > 128) {
        return writeError(res, 400, "UAID tidak valid");
      }

      const expiresAt = new Date(
        Math.floor((Date.now() + cfg.expiryHours * 60 * 60 * 1000) / 1000) * 1000
      );

      try {
        const { metadata } = await store.save(payload, uaid, expiresAt);
        cleanupInBackground(store);
        const links = signedLinks(cfg, metadata);
        return writeJSON(res, 201, {
          id: metadata.id,
          uaid: metadata.uaid,
          expires_at: metadata.expires_at,
          view_url: links.view,
          download_html_url: links.html,
          download_gzip_url: links.gzip
        });
      } catch (error) {
        console.warn(JSON.stringify({ level: "warn", message: "menyimpan transcript gagal", error: error.message }));
        return writeError(res, 400, error.message);
      }
    }
  );

  app.get("/api/v1/transcripts/:id", async (req, res) => {
    const authorized = await authorizedTranscript(cfg, store, req, res);
    if (!authorized) return;
    const links = signedLinks(cfg, authorized.metadata);
    res.set("Cache-Control", "private, no-store, max-age=0");
    writeJSON(res, 200, {
      transcript: authorized.document,
      expires_at: authorized.metadata.expires_at,
      download_html_url: links.html,
      download_gzip_url: links.gzip
    });
  });

  app.get("/api/v1/transcripts/:id/download", async (req, res) => {
    const authorized = await authorizedTranscript(cfg, store, req, res);
    if (!authorized) return;

    const format = String(req.query.format || "").trim().toLowerCase();
    const baseName =
      safeFilename(authorized.document.channel_name) ||
      `wevermore-transcript-${authorized.metadata.id.slice(0, 12)}`;

    if (["gzip", "gz", "json.gz"].includes(format)) {
      res.set({
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${baseName}.json.gz"`,
        "Content-Length": String(authorized.gzipPayload.length),
        "Content-Type": "application/gzip"
      });
      return res.status(200).send(authorized.gzipPayload);
    }

    const htmlPayload = renderHTML(authorized.document, authorized.metadata.expires_at);
    res.set({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${baseName}.html"`,
      "Content-Length": String(htmlPayload.length),
      "Content-Type": "text/html; charset=utf-8"
    });
    return res.status(200).send(htmlPayload);
  });

  app.use((error, _req, res, _next) => {
    if (error && error.type === "entity.too.large") {
      return writeError(res, 413, "payload gzip terlalu besar");
    }
    console.error(JSON.stringify({ level: "error", message: "request gagal", error: error.message }));
    return writeError(res, 500, "backend error");
  });

  return app;
}

function requireGzipBody(req, res, next) {
  if (String(req.get("Content-Encoding") || "").trim().toLowerCase() !== "gzip") {
    return writeError(res, 415, "body wajib menggunakan Content-Encoding: gzip");
  }
  return next();
}

function rawBody(limitBytes) {
  return async (req, res, next) => {
    const chunks = [];
    let total = 0;
    try {
      for await (const chunk of req) {
        total += chunk.length;
        if (total > limitBytes) {
          return writeError(res, 413, "payload gzip terlalu besar");
        }
        chunks.push(Buffer.from(chunk));
      }
      req.body = Buffer.concat(chunks);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

async function authorizedTranscript(cfg, store, req, res) {
  const id = String(req.params.id || "").trim().toLowerCase();
  if (!idPattern.test(id)) {
    writeError(res, 404, "transcript tidak ditemukan");
    return null;
  }

  let loaded;
  try {
    loaded = await store.read(id);
  } catch (error) {
    if (error instanceof NotFoundError || error.code === "ENOENT") {
      writeError(res, 404, "transcript tidak ditemukan");
      return null;
    }
    console.warn(JSON.stringify({ level: "warn", message: "membaca transcript gagal", id, error: error.message }));
    writeError(res, 500, "transcript tidak dapat dibaca");
    return null;
  }

  const uaid = String(req.query.uaid || "").trim();
  const expiresUnix = Number.parseInt(String(req.query.exp || "").trim(), 10);
  const providedSignature = String(req.query.sig || "").trim();
  const metadataExpUnix = Math.floor(new Date(loaded.metadata.expires_at).getTime() / 1000);
  const valid =
    Number.isFinite(expiresUnix) &&
    uaid === loaded.metadata.uaid &&
    expiresUnix === metadataExpUnix &&
    verifyPublic(cfg.signingSecret, id, uaid, expiresUnix, providedSignature);

  if (!valid) {
    writeError(res, 401, "URL transcript atau signature UAID tidak valid");
    return null;
  }
  if (Date.now() > expiresUnix * 1000) {
    writeError(res, 410, "URL transcript sudah kedaluwarsa");
    return null;
  }

  return loaded;
}

function signedLinks(cfg, metadata) {
  const expiresUnix = Math.floor(new Date(metadata.expires_at).getTime() / 1000);
  const sig = publicSignature(cfg.signingSecret, metadata.id, metadata.uaid, expiresUnix);
  const query = new URLSearchParams({
    uaid: metadata.uaid,
    exp: String(expiresUnix),
    sig
  }).toString();
  const apiBase = `${cfg.publicBackendURL}/api/v1/transcripts/${metadata.id}`;
  return {
    view: `${cfg.frontendURL}/transcript/${metadata.id}?${query}`,
    html: `${apiBase}/download?${query}&format=html`,
    gzip: `${apiBase}/download?${query}&format=gzip`
  };
}

function cors(cfg) {
  return (req, res, next) => {
    const origin = String(req.get("Origin") || "").trim().replace(/\/+$/, "");
    if (origin && (origin === cfg.allowedOrigin || cfg.allowedOrigin === "*")) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Content-Encoding, X-Fyneeds-UAID, X-Fyneeds-Timestamp, X-Fyneeds-Signature"
      );
    }
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    return next();
  };
}

function securityHeaders(_req, res, next) {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Frame-Options", "DENY");
  next();
}

function safeFilename(value) {
  const input = String(value || "").trim();
  let output = "";
  for (const character of input) {
    if (/^[a-zA-Z0-9_-]$/.test(character)) {
      output += character;
    } else if (character === " ") {
      output += "-";
    }
    if (output.length >= 80) break;
  }
  return output.replace(/^[-_]+|[-_]+$/g, "");
}

function writeJSON(res, status, value) {
  res.status(status).type("application/json; charset=utf-8").send(JSON.stringify(value) + "\n");
}

function writeError(res, status, message) {
  writeJSON(res, status, { error: message });
}

function cleanupInBackground(store) {
  store.cleanupExpired(new Date()).catch((error) => {
    console.warn(JSON.stringify({ level: "warn", message: "cleanup transcript gagal", error: error.message }));
  });
}

module.exports = createApp();
module.exports.createApp = createApp;
module.exports.signedLinks = signedLinks;
module.exports.safeFilename = safeFilename;
