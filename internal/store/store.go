package store

import (
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"fyneeds-transcript-backend/internal/model"
)

var idPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Store struct {
	dir             string
	hashSalt        string
	maxUncompressed int64
	mu              sync.Mutex
}

func New(dir, hashSalt string, maxUncompressed int64) (*Store, error) {
	if strings.TrimSpace(dir) == "" {
		dir = "data/transcripts"
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("membuat storage transcript: %w", err)
	}
	return &Store{dir: dir, hashSalt: hashSalt, maxUncompressed: maxUncompressed}, nil
}

func (s *Store) Save(gzipPayload []byte, uaid string, expiresAt time.Time) (model.Metadata, model.Document, error) {
	document, err := decodeDocument(gzipPayload, s.maxUncompressed)
	if err != nil {
		return model.Metadata{}, model.Document{}, err
	}
	if document.TicketID == "" || document.ChannelID == "" {
		return model.Metadata{}, model.Document{}, errors.New("metadata ticket transcript tidak lengkap")
	}
	if uaid == "" {
		return model.Metadata{}, model.Document{}, errors.New("UAID kosong")
	}

	id, err := s.newHashedID(document.TicketID, uaid)
	if err != nil {
		return model.Metadata{}, model.Document{}, err
	}
	metadata := model.Metadata{
		ID:        id,
		UAID:      uaid,
		TicketID:  document.TicketID,
		CreatedAt: time.Now().UTC(),
		ExpiresAt: expiresAt.UTC(),
		GzipBytes: int64(len(gzipPayload)),
	}

	metaJSON, err := json.Marshal(metadata)
	if err != nil {
		return model.Metadata{}, model.Document{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := writeAtomic(s.gzipPath(id), gzipPayload, 0o600); err != nil {
		return model.Metadata{}, model.Document{}, err
	}
	if err := writeAtomic(s.metaPath(id), metaJSON, 0o600); err != nil {
		_ = os.Remove(s.gzipPath(id))
		return model.Metadata{}, model.Document{}, err
	}
	return metadata, document, nil
}

func (s *Store) Read(id string) (model.Metadata, model.Document, []byte, error) {
	if !idPattern.MatchString(id) {
		return model.Metadata{}, model.Document{}, nil, os.ErrNotExist
	}
	metaPayload, err := os.ReadFile(s.metaPath(id))
	if err != nil {
		return model.Metadata{}, model.Document{}, nil, err
	}
	var metadata model.Metadata
	if err := json.Unmarshal(metaPayload, &metadata); err != nil {
		return model.Metadata{}, model.Document{}, nil, fmt.Errorf("decode metadata: %w", err)
	}
	gzipPayload, err := os.ReadFile(s.gzipPath(id))
	if err != nil {
		return model.Metadata{}, model.Document{}, nil, err
	}
	document, err := decodeDocument(gzipPayload, s.maxUncompressed)
	if err != nil {
		return model.Metadata{}, model.Document{}, nil, err
	}
	return metadata, document, gzipPayload, nil
}

func (s *Store) CleanupExpired(now time.Time) (int, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".meta.json") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".meta.json")
		if !idPattern.MatchString(id) {
			continue
		}
		payload, err := os.ReadFile(filepath.Join(s.dir, entry.Name()))
		if err != nil {
			continue
		}
		var metadata model.Metadata
		if json.Unmarshal(payload, &metadata) != nil || metadata.ExpiresAt.After(now) {
			continue
		}
		_ = os.Remove(s.metaPath(id))
		_ = os.Remove(s.gzipPath(id))
		removed++
	}
	return removed, nil
}

func decodeDocument(payload []byte, maximum int64) (model.Document, error) {
	reader, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return model.Document{}, fmt.Errorf("payload bukan gzip valid: %w", err)
	}
	defer reader.Close()
	limited := io.LimitReader(reader, maximum+1)
	plain, err := io.ReadAll(limited)
	if err != nil {
		return model.Document{}, fmt.Errorf("dekompresi transcript: %w", err)
	}
	if int64(len(plain)) > maximum {
		return model.Document{}, errors.New("transcript hasil dekompresi melebihi batas")
	}
	var document model.Document
	if err := json.Unmarshal(plain, &document); err != nil {
		return model.Document{}, fmt.Errorf("decode transcript JSON: %w", err)
	}
	if document.Version != 1 {
		return model.Document{}, fmt.Errorf("versi transcript %d tidak didukung", document.Version)
	}
	return document, nil
}

func (s *Store) newHashedID(ticketID, uaid string) (string, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	digest := sha256.New()
	_, _ = digest.Write([]byte("fyneeds-transcript-v1\n"))
	_, _ = digest.Write([]byte(ticketID))
	_, _ = digest.Write([]byte("\n" + uaid + "\n" + s.hashSalt + "\n"))
	_, _ = digest.Write(random)
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func (s *Store) gzipPath(id string) string { return filepath.Join(s.dir, id+".json.gz") }
func (s *Store) metaPath(id string) string { return filepath.Join(s.dir, id+".meta.json") }

func writeAtomic(path string, payload []byte, mode os.FileMode) error {
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, payload, mode); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}
