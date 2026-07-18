const test = require("node:test");
const assert = require("node:assert/strict");
const {
  publicSignature,
  uploadSignature,
  verifyPublic,
  verifyUpload
} = require("../src/security");

test("public signature binds UAID", () => {
  const secret = "abcdefghijklmnopqrstuvwxyz123456";
  const sig = publicSignature(secret, "abc", "uaid_test", 123);
  assert.equal(verifyPublic(secret, "abc", "uaid_test", 123, sig), true);
  assert.equal(verifyPublic(secret, "abc", "uaid_other", 123, sig), false);
});

test("upload signature and clock skew", () => {
  const secret = "abcdefghijklmnopqrstuvwxyz123456";
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const sig = uploadSignature(secret, timestamp, "uaid_test", "bodyhash");

  assert.equal(
    verifyUpload(secret, timestamp, "uaid_test", "bodyhash", sig, now, 300),
    true
  );
  assert.equal(
    verifyUpload(secret, timestamp, "uaid_other", "bodyhash", sig, now, 300),
    false
  );
  assert.equal(
    verifyUpload(secret, timestamp, "uaid_test", "bodyhash", sig, new Date(now.getTime() + 600000), 300),
    false
  );
});
