package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Address              string
	StorageDir           string
	UploadSecret         string
	SigningSecret        string
	PublicBackendURL     string
	FrontendURL          string
	AllowedOrigin        string
	Expiry               time.Duration
	UploadClockSkew      time.Duration
	MaxCompressedBytes   int64
	MaxUncompressedBytes int64
}

func Load() (Config, error) {
	if err := loadDotEnv(".env"); err != nil {
		return Config{}, err
	}
	cfg := Config{
		Address:              envOr("BACKEND_ADDRESS", ":8080"),
		StorageDir:           envOr("TRANSCRIPT_STORAGE_DIR", "data/transcripts"),
		UploadSecret:         strings.TrimSpace(os.Getenv("TRANSCRIPT_UPLOAD_SECRET")),
		SigningSecret:        strings.TrimSpace(os.Getenv("TRANSCRIPT_SIGNING_SECRET")),
		PublicBackendURL:     strings.TrimRight(strings.TrimSpace(os.Getenv("BACKEND_PUBLIC_URL")), "/"),
		FrontendURL:          strings.TrimRight(strings.TrimSpace(os.Getenv("FRONTEND_PUBLIC_URL")), "/"),
		AllowedOrigin:        strings.TrimRight(strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGIN")), "/"),
		Expiry:               time.Duration(envInt("TRANSCRIPT_EXPIRY_HOURS", 7, 1, 168)) * time.Hour,
		UploadClockSkew:      time.Duration(envInt("UPLOAD_CLOCK_SKEW_SECONDS", 300, 30, 1800)) * time.Second,
		MaxCompressedBytes:   int64(envInt("MAX_COMPRESSED_MB", 25, 1, 200)) << 20,
		MaxUncompressedBytes: int64(envInt("MAX_UNCOMPRESSED_MB", 100, 1, 500)) << 20,
	}
	if len(cfg.UploadSecret) < 32 {
		return Config{}, errors.New("TRANSCRIPT_UPLOAD_SECRET minimal 32 karakter")
	}
	if len(cfg.SigningSecret) < 32 {
		return Config{}, errors.New("TRANSCRIPT_SIGNING_SECRET minimal 32 karakter")
	}
	if cfg.PublicBackendURL == "" {
		return Config{}, errors.New("BACKEND_PUBLIC_URL wajib diisi")
	}
	if cfg.FrontendURL == "" {
		return Config{}, errors.New("FRONTEND_PUBLIC_URL wajib diisi")
	}
	if cfg.AllowedOrigin == "" {
		cfg.AllowedOrigin = cfg.FrontendURL
	}
	return cfg, nil
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback, minimum, maximum int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil {
		return fallback
	}
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

func loadDotEnv(path string) error {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("membuka .env: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" {
			if _, exists := os.LookupEnv(key); !exists {
				_ = os.Setenv(key, value)
			}
		}
	}
	return scanner.Err()
}
