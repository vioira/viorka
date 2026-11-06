package settings

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type backupTransport func(*http.Request) (*http.Response, error)

func (f backupTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestS3EncryptedUploadFailureAndDeletion(t *testing.T) {
	b, store := testBackups(t)
	ctx := context.Background()
	store.policy.S3 = S3Config{Enabled: true, Endpoint: "https://storage.example.com", Region: "us-east-1", Bucket: "panel-backups", Prefix: "panel-a", AccessKey: "access-id", SecretKey: "secret-value", PathStyle: true}
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	failed := false
	puts, deletes := 0, 0
	http.DefaultTransport = backupTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "storage.example.com" || !strings.HasPrefix(r.URL.Path, "/panel-backups/panel-a/") {
			t.Errorf("wrong destination %s", r.URL)
		}
		if !strings.Contains(r.Header.Get("Authorization"), "Credential=access-id/") {
			t.Error("missing signature")
		}
		status := 200
		switch r.Method {
		case "PUT":
			puts++
			data, err := io.ReadAll(r.Body)
			if err != nil || len(data) == 0 || strings.Contains(string(data), "snapshot") {
				t.Error("not encrypted", err)
			}
			if failed {
				status = 403
			}
		case "DELETE":
			deletes++
		default:
			t.Errorf("unexpected method %s", r.Method)
		}
		return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	v, err := b.Create(ctx, "manual")
	if err != nil || v.Status != "succeeded" || puts != 1 {
		t.Fatal(v, err, puts)
	}
	failed = true
	bad, err := b.Create(ctx, "manual")
	if err == nil || bad.Status != "failed" {
		t.Fatal(bad, err)
	}
	// Changing destination must not send the new secret to the old endpoint.
	store.policy.S3.Endpoint = "https://new.example.com"
	store.policy.S3.AccessKey = "new-access"
	store.policy.S3.SecretKey = "new-secret"
	if err = b.Delete(ctx, "manual", v.ID); err != nil || deletes != 1 {
		t.Fatal(err, deletes)
	}
	if _, err = b.Download(bad.ID); err == nil {
		t.Fatal("failed upload advertised as downloadable")
	}
}
