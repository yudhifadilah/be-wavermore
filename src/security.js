const crypto = require("node:crypto");

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function sha256Hex(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function safeEqualHex(expected, provided) {
  if (!/^[a-f0-9]+$/i.test(String(provided || ""))) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function uploadSignature(secret, timestamp, uaid, bodyHash) {
  return hmacHex(secret, `${timestamp}\n${uaid}\n${bodyHash}`);
}

function verifyUpload(secret, timestamp, uaid, bodyHash, provided, now, skewSeconds) {
  const unix = Number.parseInt(String(timestamp || "").trim(), 10);
  if (!Number.isFinite(unix) || !uaid || !provided) return false;

  const requestTimeMs = unix * 1000;
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  if (Math.abs(nowMs - requestTimeMs) > skewSeconds * 1000) return false;

  const expected = uploadSignature(secret, String(timestamp).trim(), uaid, bodyHash);
  return safeEqualHex(expected, provided);
}

function publicSignature(secret, id, uaid, expiresUnix) {
  return hmacHex(secret, `${id}.${uaid}.${expiresUnix}`);
}

function verifyPublic(secret, id, uaid, expiresUnix, provided) {
  const expected = publicSignature(secret, id, uaid, expiresUnix);
  return Boolean(provided) && safeEqualHex(expected, provided);
}

module.exports = {
  hmacHex,
  publicSignature,
  sha256Hex,
  uploadSignature,
  verifyPublic,
  verifyUpload
};
