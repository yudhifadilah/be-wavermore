package security

import (
	"strconv"
	"testing"
	"time"
)

func TestPublicSignatureBindsUAID(t *testing.T) {
	secret := "abcdefghijklmnopqrstuvwxyz123456"
	sig := PublicSignature(secret, "abc", "uaid_test", 123)
	if !VerifyPublic(secret, "abc", "uaid_test", 123, sig) {
		t.Fatal("signature should be valid")
	}
	if VerifyPublic(secret, "abc", "uaid_other", 123, sig) {
		t.Fatal("signature must bind UAID")
	}
}

func TestUploadSignatureAndClockSkew(t *testing.T) {
	secret := "abcdefghijklmnopqrstuvwxyz123456"
	now := time.Now().UTC().Truncate(time.Second)
	timestamp := strconv.FormatInt(now.Unix(), 10)
	sig := UploadSignature(secret, timestamp, "uaid_test", "bodyhash")
	if !VerifyUpload(secret, timestamp, "uaid_test", "bodyhash", sig, now, 5*time.Minute) {
		t.Fatal("upload signature should be valid")
	}
	if VerifyUpload(secret, timestamp, "uaid_other", "bodyhash", sig, now, 5*time.Minute) {
		t.Fatal("upload signature must bind UAID")
	}
	if VerifyUpload(secret, timestamp, "uaid_test", "bodyhash", sig, now.Add(10*time.Minute), 5*time.Minute) {
		t.Fatal("old upload signature should be rejected")
	}
}
