package httpapi

import (
	"bytes"
	"fmt"
	"html/template"
	"strings"
	"time"

	"fyneeds-transcript-backend/internal/model"
)

var transcriptTemplate = template.Must(template.New("transcript").Funcs(template.FuncMap{
	"date": func(value time.Time) string {
		return value.In(time.FixedZone("WIB", 7*60*60)).Format("02 Jan 2006 15:04:05 WIB")
	},
	"money": func(value int64) string {
		digits := fmt.Sprintf("%d", value)
		for index := len(digits) - 3; index > 0; index -= 3 {
			digits = digits[:index] + "." + digits[index:]
		}
		return "Rp " + digits
	},
	"image": func(contentType string) bool { return strings.HasPrefix(strings.ToLower(contentType), "image/") },
	"initial": func(value string) string {
		for _, character := range strings.TrimSpace(value) {
			return strings.ToUpper(string(character))
		}
		return "?"
	},
}).Parse(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>{{.Document.ShopName}} Transcript • {{.Document.ChannelName}}</title>
<style>
:root{color-scheme:dark;background:#0b1020;color:#edf2ff;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#0b1020,#111831);min-height:100vh}.wrap{max-width:980px;margin:auto;padding:32px 18px 80px}.header,.message{background:rgba(24,33,64,.9);border:1px solid #2d3b6a;border-radius:16px;box-shadow:0 12px 30px rgba(0,0,0,.22)}.header{padding:24px;margin-bottom:20px}.brand{font-size:12px;letter-spacing:.15em;color:#88a6ff;text-transform:uppercase}.title{font-size:28px;margin:8px 0}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:18px}.meta div{padding:12px;border-radius:10px;background:#111a35}.label{font-size:11px;color:#91a0c8;text-transform:uppercase}.value{margin-top:4px;font-weight:650}.notice{margin:14px 0;padding:12px;border-radius:10px;background:#3a2d0a;color:#ffe69a}.message{display:grid;grid-template-columns:44px 1fr;gap:12px;padding:16px;margin:10px 0}.avatar{width:42px;height:42px;border-radius:50%;background:#26345f;object-fit:cover}.avatar-fallback{display:grid;place-items:center;font-weight:800}.author{font-weight:750}.username,.time,.edited{font-size:12px;color:#91a0c8;margin-left:7px}.content{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:7px;line-height:1.5}.reply{font-size:12px;color:#9eb3ed;border-left:2px solid #667eea;padding-left:8px}.embed{border-left:4px solid #5865f2;background:#0d1429;border-radius:8px;padding:12px;margin-top:10px}.embed-title{font-weight:750}.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.field{background:#131d3a;padding:9px;border-radius:8px}.attachment{margin-top:10px}.attachment img{max-width:min(100%,720px);max-height:520px;border-radius:10px;border:1px solid #34436f}.attachment a,.embed a{color:#9bb7ff}.footer{text-align:center;color:#7180a8;margin-top:28px;font-size:12px}
</style></head>
<body><main class="wrap">
<section class="header"><div class="brand">{{.Document.ShopName}} • Ticket Transcript</div><h1 class="title">#{{.Document.ChannelName}}</h1>
<div class="meta"><div><span class="label">Ticket ID</span><div class="value">{{.Document.TicketID}}</div></div><div><span class="label">Kategori</span><div class="value">{{.Document.Category}}</div></div><div><span class="label">Buyer</span><div class="value">{{.Document.BuyerUsername}}</div></div><div><span class="label">Nominal</span><div class="value">{{money .Document.Amount}}</div></div><div><span class="label">Dibuat</span><div class="value">{{date .Document.CreatedAt}}</div></div><div><span class="label">Ditutup</span><div class="value">{{date .Document.ClosedAt}}</div></div></div>
{{if .Document.CloseNote}}<div class="notice"><strong>Catatan:</strong> {{.Document.CloseNote}}</div>{{end}}
{{if .Document.Truncated}}<div class="notice">Transcript mencapai batas pesan dan mungkin tidak memuat pesan paling lama.</div>{{end}}</section>
{{range .Document.Messages}}<article class="message">
<div>{{if .Author.AvatarURL}}<img class="avatar" src="{{.Author.AvatarURL}}" alt="">{{else}}<div class="avatar avatar-fallback">{{initial .Author.DisplayName}}</div>{{end}}</div>
<div>{{if .ReplyToID}}<div class="reply">Membalas pesan {{.ReplyToID}}</div>{{end}}<span class="author">{{.Author.DisplayName}}</span><span class="username">@{{.Author.Username}}{{if .Author.Bot}} • BOT{{end}}</span><span class="time">{{date .Timestamp}}</span>{{if .EditedAt}}<span class="edited">(diedit)</span>{{end}}
{{if .Content}}<div class="content">{{.Content}}</div>{{end}}
{{range .Embeds}}<div class="embed">{{if .Title}}<div class="embed-title">{{if .URL}}<a href="{{.URL}}">{{.Title}}</a>{{else}}{{.Title}}{{end}}</div>{{end}}{{if .Description}}<div class="content">{{.Description}}</div>{{end}}{{if .Fields}}<div class="fields">{{range .Fields}}<div class="field"><strong>{{.Name}}</strong><div class="content">{{.Value}}</div></div>{{end}}</div>{{end}}{{if .Image}}<div class="attachment"><img src="{{.Image.URL}}" alt="embed image"></div>{{end}}</div>{{end}}
{{range .Attachments}}<div class="attachment">{{if image .ContentType}}<a href="{{.URL}}"><img src="{{.URL}}" alt="{{.Filename}}"></a>{{else}}<a href="{{.URL}}">📎 {{.Filename}}</a>{{end}}</div>{{end}}
</div></article>{{end}}
<div class="footer">Dibuat otomatis oleh {{.Document.ShopName}} • Link asli kedaluwarsa {{date .ExpiresAt}}</div>
</main></body></html>`))

func renderHTML(document model.Document, expiresAt time.Time) ([]byte, error) {
	var buffer bytes.Buffer
	data := struct {
		Document  model.Document
		ExpiresAt time.Time
	}{Document: document, ExpiresAt: expiresAt}
	if err := transcriptTemplate.Execute(&buffer, data); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}
