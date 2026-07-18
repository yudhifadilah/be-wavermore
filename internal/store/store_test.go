package store

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"testing"
	"time"

	"fyneeds-transcript-backend/internal/model"
)

func TestSaveRead(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir, "01234567890123456789012345678901", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	doc := model.Document{Version: 1, TicketID: "ticket", ChannelID: "channel", ClosedAt: time.Now().UTC()}
	plain, _ := json.Marshal(doc)
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	_, _ = writer.Write(plain)
	_ = writer.Close()
	meta, _, err := store.Save(buffer.Bytes(), "uaid_test", time.Now().Add(7*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(meta.ID) != 64 {
		t.Fatalf("id length=%d", len(meta.ID))
	}
	_, decoded, _, err := store.Read(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.TicketID != "ticket" {
		t.Fatalf("ticket=%q", decoded.TicketID)
	}
}
