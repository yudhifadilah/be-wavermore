package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"fyneeds-transcript-backend/internal/config"
	"fyneeds-transcript-backend/internal/model"
	"fyneeds-transcript-backend/internal/security"
	"fyneeds-transcript-backend/internal/store"
)

type Server struct {
	cfg    config.Config
	store  *store.Store
	logger *slog.Logger
	mux    *http.ServeMux
}

type receiptResponse struct {
	ID              string    `json:"id"`
	UAID            string    `json:"uaid"`
	ExpiresAt       time.Time `json:"expires_at"`
	ViewURL         string    `json:"view_url"`
	DownloadHTMLURL string    `json:"download_html_url"`
	DownloadGzipURL string    `json:"download_gzip_url"`
}

type transcriptResponse struct {
	Transcript      model.Document `json:"transcript"`
	ExpiresAt       time.Time      `json:"expires_at"`
	DownloadHTMLURL string         `json:"download_html_url"`
	DownloadGzipURL string         `json:"download_gzip_url"`
}

func New(cfg config.Config, transcriptStore *store.Store, logger *slog.Logger) *Server {
	server := &Server{cfg: cfg, store: transcriptStore, logger: logger, mux: http.NewServeMux()}
	server.routes()
	return server
}

func (s *Server) Handler() http.Handler {
	return s.securityHeaders(s.cors(s.mux))
}

func (s *Server) StartCleanup(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Minute)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				removed, err := s.store.CleanupExpired(now.UTC())
				if err != nil {
					s.logger.Warn("cleanup transcript gagal", "error", err)
				} else if removed > 0 {
					s.logger.Info("transcript kedaluwarsa dihapus", "count", removed)
				}
			}
		}
	}()
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.handleHealth)
	s.mux.HandleFunc("POST /api/v1/transcripts", s.handleUpload)
	s.mux.HandleFunc("GET /api/v1/transcripts/{id}", s.handleGet)
	s.mux.HandleFunc("GET /api/v1/transcripts/{id}/download", s.handleDownload)
	s.mux.HandleFunc("OPTIONS /", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "fyneeds-transcript-backend"})
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if !strings.EqualFold(strings.TrimSpace(r.Header.Get("Content-Encoding")), "gzip") {
		writeError(w, http.StatusUnsupportedMediaType, "body wajib menggunakan Content-Encoding: gzip")
		return
	}

	payload, err := io.ReadAll(io.LimitReader(r.Body, s.cfg.MaxCompressedBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "gagal membaca payload")
		return
	}
	if int64(len(payload)) > s.cfg.MaxCompressedBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "payload gzip terlalu besar")
		return
	}

	timestamp := strings.TrimSpace(r.Header.Get("X-Fyneeds-Timestamp"))
	uaid := strings.TrimSpace(r.Header.Get("X-Fyneeds-UAID"))
	providedSignature := strings.TrimSpace(r.Header.Get("X-Fyneeds-Signature"))
	digest := sha256.Sum256(payload)
	bodyHash := hex.EncodeToString(digest[:])
	if !security.VerifyUpload(s.cfg.UploadSecret, timestamp, uaid, bodyHash, providedSignature, time.Now().UTC(), s.cfg.UploadClockSkew) {
		writeError(w, http.StatusUnauthorized, "signature upload tidak valid")
		return
	}
	if len(uaid) < 12 || len(uaid) > 128 {
		writeError(w, http.StatusBadRequest, "UAID tidak valid")
		return
	}

	expiresAt := time.Now().UTC().Add(s.cfg.Expiry).Truncate(time.Second)
	metadata, _, err := s.store.Save(payload, uaid, expiresAt)
	if err != nil {
		s.logger.Warn("menyimpan transcript gagal", "error", err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	links := s.signedLinks(metadata)
	writeJSON(w, http.StatusCreated, receiptResponse{
		ID:              metadata.ID,
		UAID:            metadata.UAID,
		ExpiresAt:       metadata.ExpiresAt,
		ViewURL:         links.view,
		DownloadHTMLURL: links.html,
		DownloadGzipURL: links.gzip,
	})
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	metadata, document, _, ok := s.authorizedTranscript(w, r)
	if !ok {
		return
	}
	links := s.signedLinks(metadata)
	w.Header().Set("Cache-Control", "private, no-store, max-age=0")
	writeJSON(w, http.StatusOK, transcriptResponse{
		Transcript:      document,
		ExpiresAt:       metadata.ExpiresAt,
		DownloadHTMLURL: links.html,
		DownloadGzipURL: links.gzip,
	})
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	metadata, document, gzipPayload, ok := s.authorizedTranscript(w, r)
	if !ok {
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	baseName := safeFilename(document.ChannelName)
	if baseName == "" {
		baseName = "fyneeds-transcript-" + metadata.ID[:12]
	}

	switch format {
	case "gzip", "gz", "json.gz":
		w.Header().Set("Content-Type", "application/gzip")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.json.gz"`, baseName))
		w.Header().Set("Content-Length", strconv.Itoa(len(gzipPayload)))
		w.Header().Set("Cache-Control", "private, no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(gzipPayload)
	default:
		htmlPayload, err := renderHTML(document, metadata.ExpiresAt)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "gagal membuat file HTML")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.html"`, baseName))
		w.Header().Set("Content-Length", strconv.Itoa(len(htmlPayload)))
		w.Header().Set("Cache-Control", "private, no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(htmlPayload)
	}
}

func (s *Server) authorizedTranscript(w http.ResponseWriter, r *http.Request) (model.Metadata, model.Document, []byte, bool) {
	id := strings.ToLower(strings.TrimSpace(r.PathValue("id")))
	metadata, document, payload, err := s.store.Read(id)
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "transcript tidak ditemukan")
		return model.Metadata{}, model.Document{}, nil, false
	}
	if err != nil {
		s.logger.Warn("membaca transcript gagal", "id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "transcript tidak dapat dibaca")
		return model.Metadata{}, model.Document{}, nil, false
	}

	query := r.URL.Query()
	uaid := strings.TrimSpace(query.Get("uaid"))
	expiresUnix, err := strconv.ParseInt(strings.TrimSpace(query.Get("exp")), 10, 64)
	providedSignature := strings.TrimSpace(query.Get("sig"))
	if err != nil || uaid != metadata.UAID || expiresUnix != metadata.ExpiresAt.Unix() || !security.VerifyPublic(s.cfg.SigningSecret, id, uaid, expiresUnix, providedSignature) {
		writeError(w, http.StatusUnauthorized, "URL transcript atau signature UAID tidak valid")
		return model.Metadata{}, model.Document{}, nil, false
	}
	if time.Now().UTC().Unix() > expiresUnix {
		writeError(w, http.StatusGone, "URL transcript sudah kedaluwarsa")
		return model.Metadata{}, model.Document{}, nil, false
	}
	return metadata, document, payload, true
}

type signedURLs struct {
	view string
	html string
	gzip string
}

func (s *Server) signedLinks(metadata model.Metadata) signedURLs {
	exp := metadata.ExpiresAt.Unix()
	sig := security.PublicSignature(s.cfg.SigningSecret, metadata.ID, metadata.UAID, exp)
	query := url.Values{}
	query.Set("uaid", metadata.UAID)
	query.Set("exp", strconv.FormatInt(exp, 10))
	query.Set("sig", sig)
	encoded := query.Encode()
	apiBase := s.cfg.PublicBackendURL + "/api/v1/transcripts/" + metadata.ID
	return signedURLs{
		view: s.cfg.FrontendURL + "/transcript/" + metadata.ID + "?" + encoded,
		html: apiBase + "/download?" + encoded + "&format=html",
		gzip: apiBase + "/download?" + encoded + "&format=gzip",
	}
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
		if origin != "" && (origin == s.cfg.AllowedOrigin || s.cfg.AllowedOrigin == "*") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Encoding, X-Fyneeds-UAID, X-Fyneeds-Timestamp, X-Fyneeds-Signature")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func safeFilename(value string) string {
	value = strings.TrimSpace(value)
	var result strings.Builder
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z', character >= 'A' && character <= 'Z', character >= '0' && character <= '9', character == '-', character == '_':
			result.WriteRune(character)
		case character == ' ':
			result.WriteByte('-')
		}
		if result.Len() >= 80 {
			break
		}
	}
	return strings.Trim(result.String(), "-_")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
