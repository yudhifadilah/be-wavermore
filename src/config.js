const dotenv = require("dotenv");

dotenv.config({ override: false, quiet: true });

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function envOr(key, fallback) {
  const value = String(process.env[key] || "").trim();
  return value || fallback;
}

function envInt(key, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(process.env[key] || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < minimum) return minimum;
  if (parsed > maximum) return maximum;
  return parsed;
}

function parseAddress(value) {
  const address = String(value || ":8080").trim();
  if (/^\d+$/.test(address)) {
    return { host: "0.0.0.0", port: Number.parseInt(address, 10) };
  }
  if (address.startsWith(":")) {
    return { host: "0.0.0.0", port: Number.parseInt(address.slice(1), 10) };
  }
  const separator = address.lastIndexOf(":");
  if (separator > -1) {
    const host = address.slice(0, separator) || "0.0.0.0";
    const port = Number.parseInt(address.slice(separator + 1), 10);
    return { host, port };
  }
  return { host: "0.0.0.0", port: 8080 };
}

function loadConfig() {
  const address = envOr("BACKEND_ADDRESS", ":8080");
  const { host, port } = parseAddress(address);
  const uploadSecret = String(process.env.TRANSCRIPT_UPLOAD_SECRET || "").trim();
  const signingSecret = String(process.env.TRANSCRIPT_SIGNING_SECRET || "").trim();
  const publicBackendURL = trimTrailingSlash(process.env.BACKEND_PUBLIC_URL);
  const frontendURL = trimTrailingSlash(process.env.FRONTEND_PUBLIC_URL);
  const allowedOrigin =
    trimTrailingSlash(process.env.CORS_ALLOWED_ORIGIN) || frontendURL;
  const hasBlobToken = Boolean(String(process.env.BLOB_READ_WRITE_TOKEN || "").trim());
  const provider = envOr(
    "TRANSCRIPT_STORAGE_PROVIDER",
    hasBlobToken || process.env.VERCEL ? "vercel-blob" : "filesystem"
  ).toLowerCase();
  const blobAccess = envOr("BLOB_ACCESS", "private").toLowerCase();

  const cfg = {
    address,
    host,
    port: Number.isFinite(port) ? port : 8080,
    uploadSecret,
    signingSecret,
    publicBackendURL,
    frontendURL,
    allowedOrigin,
    expiryHours: envInt("TRANSCRIPT_EXPIRY_HOURS", 7, 1, 168),
    uploadClockSkewSeconds: envInt("UPLOAD_CLOCK_SKEW_SECONDS", 300, 30, 1800),
    maxCompressedBytes: envInt("MAX_COMPRESSED_MB", 25, 1, 200) * 1024 * 1024,
    maxUncompressedBytes: envInt("MAX_UNCOMPRESSED_MB", 100, 1, 500) * 1024 * 1024,
    storageProvider: provider,
    storageDir: envOr("TRANSCRIPT_STORAGE_DIR", "data/transcripts"),
    blobPrefix: envOr("TRANSCRIPT_BLOB_PREFIX", "transcripts").replace(/^\/+|\/+$/g, ""),
    blobAccess
  };

  if (cfg.uploadSecret.length < 32) {
    throw new Error("TRANSCRIPT_UPLOAD_SECRET minimal 32 karakter");
  }
  if (cfg.signingSecret.length < 32) {
    throw new Error("TRANSCRIPT_SIGNING_SECRET minimal 32 karakter");
  }
  if (!cfg.publicBackendURL) {
    throw new Error("BACKEND_PUBLIC_URL wajib diisi");
  }
  if (!cfg.frontendURL) {
    throw new Error("FRONTEND_PUBLIC_URL wajib diisi");
  }
  if (!["filesystem", "vercel-blob"].includes(cfg.storageProvider)) {
    throw new Error("TRANSCRIPT_STORAGE_PROVIDER harus filesystem atau vercel-blob");
  }
  if (cfg.storageProvider === "vercel-blob" && !hasBlobToken && !process.env.VERCEL_OIDC_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN wajib diisi untuk storage Vercel Blob");
  }
  if (!["public", "private"].includes(cfg.blobAccess)) {
    throw new Error("BLOB_ACCESS harus public atau private");
  }

  return cfg;
}

module.exports = { loadConfig };
