package model

import "time"

type Document struct {
	Version       int       `json:"version"`
	ShopName      string    `json:"shop_name"`
	TicketID      string    `json:"ticket_id"`
	GuildID       string    `json:"guild_id"`
	ChannelID     string    `json:"channel_id"`
	ChannelName   string    `json:"channel_name"`
	BuyerID       string    `json:"buyer_id"`
	BuyerUsername string    `json:"buyer_username"`
	Category      string    `json:"category"`
	CreatedAt     time.Time `json:"created_at"`
	ClosedAt      time.Time `json:"closed_at"`
	ClosedBy      string    `json:"closed_by"`
	Amount        int64     `json:"amount"`
	CloseNote     string    `json:"close_note,omitempty"`
	MessageCount  int       `json:"message_count"`
	Truncated     bool      `json:"truncated"`
	Messages      []Message `json:"messages"`
}

type Message struct {
	ID          string       `json:"id"`
	Type        int          `json:"type"`
	Author      Author       `json:"author"`
	Content     string       `json:"content"`
	Timestamp   time.Time    `json:"timestamp"`
	EditedAt    *time.Time   `json:"edited_at,omitempty"`
	ReplyToID   string       `json:"reply_to_id,omitempty"`
	Attachments []Attachment `json:"attachments,omitempty"`
	Embeds      []Embed      `json:"embeds,omitempty"`
}

type Author struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	Bot         bool   `json:"bot"`
}

type Attachment struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	Description string `json:"description,omitempty"`
	ContentType string `json:"content_type,omitempty"`
	URL         string `json:"url"`
	ProxyURL    string `json:"proxy_url,omitempty"`
	Size        int64  `json:"size"`
	Width       int    `json:"width,omitempty"`
	Height      int    `json:"height,omitempty"`
}

type Embed struct {
	Title       string       `json:"title,omitempty"`
	Description string       `json:"description,omitempty"`
	URL         string       `json:"url,omitempty"`
	Color       int          `json:"color,omitempty"`
	Timestamp   string       `json:"timestamp,omitempty"`
	Fields      []EmbedField `json:"fields,omitempty"`
	Thumbnail   *EmbedMedia  `json:"thumbnail,omitempty"`
	Image       *EmbedMedia  `json:"image,omitempty"`
	Footer      *EmbedFooter `json:"footer,omitempty"`
	Author      *EmbedAuthor `json:"author,omitempty"`
}

type EmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline"`
}

type EmbedMedia struct {
	URL      string `json:"url,omitempty"`
	ProxyURL string `json:"proxy_url,omitempty"`
	Width    int    `json:"width,omitempty"`
	Height   int    `json:"height,omitempty"`
}

type EmbedFooter struct {
	Text    string `json:"text,omitempty"`
	IconURL string `json:"icon_url,omitempty"`
}

type EmbedAuthor struct {
	Name    string `json:"name,omitempty"`
	URL     string `json:"url,omitempty"`
	IconURL string `json:"icon_url,omitempty"`
}

type Metadata struct {
	ID        string    `json:"id"`
	UAID      string    `json:"uaid"`
	TicketID  string    `json:"ticket_id"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	GzipBytes int64     `json:"gzip_bytes"`
}
