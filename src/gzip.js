const { Readable } = require("node:stream");
const zlib = require("node:zlib");

function gunzipLimited(payload, maximumBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const gunzip = zlib.createGunzip();

    gunzip.on("data", (chunk) => {
      total += chunk.length;
      if (total > maximumBytes) {
        gunzip.destroy(new Error("transcript hasil dekompresi melebihi batas"));
        return;
      }
      chunks.push(chunk);
    });
    gunzip.on("error", (error) => reject(error));
    gunzip.on("end", () => resolve(Buffer.concat(chunks)));

    Readable.from(payload).pipe(gunzip);
  });
}

module.exports = { gunzipLimited };
