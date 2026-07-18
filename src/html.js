function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function isImage(contentType) {
  return String(contentType || "").toLowerCase().startsWith("image/");
}

function initial(value) {
  const text = String(value || "").trim();
  return text ? escapeHtml([...text][0].toUpperCase()) : "?";
}

function formatDateWib(value) {
  const date = value ? new Date(value) : new Date(0);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
    timeZoneName: "short"
  }).format(date);
}

function formatMoney(value) {
  const number = Number.parseInt(value || 0, 10);
  return `Rp ${new Intl.NumberFormat("id-ID").format(Number.isFinite(number) ? number : 0)}`;
}

function renderEmbed(embed) {
  const title = embed.title
    ? `<div class="embed-title">${
        embed.url
          ? `<a href="${escapeAttr(embed.url)}" rel="noreferrer">${escapeHtml(embed.title)}</a>`
          : escapeHtml(embed.title)
      }</div>`
    : "";
  const description = embed.description
    ? `<div class="content">${escapeHtml(embed.description)}</div>`
    : "";
  const fields = Array.isArray(embed.fields) && embed.fields.length
    ? `<div class="fields">${embed.fields
        .map(
          (field) =>
            `<div class="field"><strong>${escapeHtml(field.name)}</strong><div class="content">${escapeHtml(field.value)}</div></div>`
        )
        .join("")}</div>`
    : "";
  const image = embed.image && embed.image.url
    ? `<div class="attachment"><img src="${escapeAttr(embed.image.url)}" alt="embed image"></div>`
    : "";
  const thumbnail = embed.thumbnail && embed.thumbnail.url
    ? `<div class="attachment small"><img src="${escapeAttr(embed.thumbnail.url)}" alt="embed thumbnail"></div>`
    : "";

  return `<div class="embed">${title}${description}${fields}${image}${thumbnail}</div>`;
}

function renderAttachment(attachment) {
  const url = escapeAttr(attachment.url);
  const filename = escapeHtml(attachment.filename || "attachment");
  if (isImage(attachment.content_type)) {
    return `<div class="attachment"><a href="${url}" rel="noreferrer"><img src="${url}" alt="${filename}"></a></div>`;
  }
  return `<div class="attachment"><a href="${url}" rel="noreferrer">Attachment: ${filename}</a></div>`;
}

function renderMessage(message) {
  const author = message.author || {};
  const avatar = author.avatar_url
    ? `<img class="avatar" src="${escapeAttr(author.avatar_url)}" alt="">`
    : `<div class="avatar avatar-fallback">${initial(author.display_name || author.username)}</div>`;
  const reply = message.reply_to_id
    ? `<div class="reply">Membalas pesan ${escapeHtml(message.reply_to_id)}</div>`
    : "";
  const content = message.content
    ? `<div class="content">${escapeHtml(message.content)}</div>`
    : "";
  const embeds = Array.isArray(message.embeds) ? message.embeds.map(renderEmbed).join("") : "";
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.map(renderAttachment).join("")
    : "";
  const edited = message.edited_at ? `<span class="edited">(diedit)</span>` : "";

  return `<article class="message">
<div>${avatar}</div>
<div>${reply}<span class="author">${escapeHtml(author.display_name || author.username || "Unknown")}</span><span class="username">@${escapeHtml(author.username || "unknown")}${author.bot ? " - BOT" : ""}</span><span class="time">${formatDateWib(message.timestamp)}</span>${edited}
${content}${embeds}${attachments}
</div></article>`;
}

function renderHTML(document, expiresAt) {
  const messages = Array.isArray(document.messages) ? document.messages : [];
  const closeNote = document.close_note
    ? `<div class="notice"><strong>Catatan:</strong> ${escapeHtml(document.close_note)}</div>`
    : "";
  const truncated = document.truncated
    ? `<div class="notice">Transcript mencapai batas pesan dan mungkin tidak memuat pesan paling lama.</div>`
    : "";

  return Buffer.from(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>${escapeHtml(document.shop_name)} Transcript - ${escapeHtml(document.channel_name)}</title>
<style>
:root{color-scheme:dark;background:#0b1020;color:#edf2ff;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#0b1020,#111831);min-height:100vh}.wrap{max-width:980px;margin:auto;padding:32px 18px 80px}.header,.message{background:rgba(24,33,64,.9);border:1px solid #2d3b6a;border-radius:16px;box-shadow:0 12px 30px rgba(0,0,0,.22)}.header{padding:24px;margin-bottom:20px}.brand{font-size:12px;letter-spacing:.15em;color:#88a6ff;text-transform:uppercase}.title{font-size:28px;margin:8px 0}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:18px}.meta div{padding:12px;border-radius:10px;background:#111a35}.label{font-size:11px;color:#91a0c8;text-transform:uppercase}.value{margin-top:4px;font-weight:650}.notice{margin:14px 0;padding:12px;border-radius:10px;background:#3a2d0a;color:#ffe69a}.message{display:grid;grid-template-columns:44px 1fr;gap:12px;padding:16px;margin:10px 0}.avatar{width:42px;height:42px;border-radius:50%;background:#26345f;object-fit:cover}.avatar-fallback{display:grid;place-items:center;font-weight:800}.author{font-weight:750}.username,.time,.edited{font-size:12px;color:#91a0c8;margin-left:7px}.content{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:7px;line-height:1.5}.reply{font-size:12px;color:#9eb3ed;border-left:2px solid #667eea;padding-left:8px}.embed{border-left:4px solid #5865f2;background:#0d1429;border-radius:8px;padding:12px;margin-top:10px}.embed-title{font-weight:750}.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.field{background:#131d3a;padding:9px;border-radius:8px}.attachment{margin-top:10px}.attachment img{max-width:min(100%,720px);max-height:520px;border-radius:10px;border:1px solid #34436f}.attachment.small img{max-width:180px}.attachment a,.embed a{color:#9bb7ff}.footer{text-align:center;color:#7180a8;margin-top:28px;font-size:12px}
</style></head>
<body><main class="wrap">
<section class="header"><div class="brand">${escapeHtml(document.shop_name)} - Ticket Transcript</div><h1 class="title">#${escapeHtml(document.channel_name)}</h1>
<div class="meta"><div><span class="label">Ticket ID</span><div class="value">${escapeHtml(document.ticket_id)}</div></div><div><span class="label">Kategori</span><div class="value">${escapeHtml(document.category)}</div></div><div><span class="label">Buyer</span><div class="value">${escapeHtml(document.buyer_username)}</div></div><div><span class="label">Nominal</span><div class="value">${formatMoney(document.amount)}</div></div><div><span class="label">Dibuat</span><div class="value">${formatDateWib(document.created_at)}</div></div><div><span class="label">Ditutup</span><div class="value">${formatDateWib(document.closed_at)}</div></div></div>
${closeNote}${truncated}</section>
${messages.map(renderMessage).join("")}
<div class="footer">Dibuat otomatis oleh ${escapeHtml(document.shop_name)} - Link asli kedaluwarsa ${formatDateWib(expiresAt)}</div>
</main></body></html>`, "utf8");
}

module.exports = { renderHTML };
