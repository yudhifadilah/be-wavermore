package security

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"
)

func UploadSignature(secret, timestamp, uaid, bodyHash string) string {
	return hmacHex([]byte(secret), timestamp+"\n"+uaid+"\n"+bodyHash)
}

func VerifyUpload(secret, timestamp, uaid, bodyHash, provided string, now time.Time, skew time.Duration) bool {
	unix, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || uaid == "" || provided == "" {
		return false
	}
	requestTime := time.Unix(unix, 0).UTC()
	if now.Sub(requestTime) > skew || requestTime.Sub(now) > skew {
		return false
	}
	expected := UploadSignature(secret, timestamp, uaid, bodyHash)
	return hmac.Equal([]byte(expected), []byte(provided))
}

func PublicSignature(secret, id, uaid string, expiresUnix int64) string {
	payload := fmt.Sprintf("%s.%s.%d", id, uaid, expiresUnix)
	return hmacHex([]byte(secret), payload)
}

func VerifyPublic(secret, id, uaid string, expiresUnix int64, provided string) bool {
	expected := PublicSignature(secret, id, uaid, expiresUnix)
	return provided != "" && hmac.Equal([]byte(expected), []byte(provided))
}

func SHA256Hex(payload []byte) string {
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:])
}

func hmacHex(secret []byte, payload string) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}
