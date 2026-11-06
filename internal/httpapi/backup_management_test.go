package httpapi

import (
	"encoding/json"
	"io"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/settings"
)

func TestBackupPolicyAndFileEndpoints(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	p := decodeResponse[settings.BackupPolicy](t, f.request("GET", "/api/v1/backups/policy", nil, true), 200)
	p.Cron = "0 2 * * *"
	p.RetentionDays = 0
	p.MaxCopies = 0
	p.S3.SecretKey = "test-backup-secret"
	saved := decodeResponse[settings.BackupPolicy](t, f.request("PUT", "/api/v1/backups/policy", p, true), 200)
	raw, _ := json.Marshal(saved)
	if strings.Contains(string(raw), p.S3.SecretKey) || !saved.S3.SecretConfigured {
		t.Fatal("secret disclosure")
	}
	expectStatus(t, f.request("PUT", "/api/v1/backups/policy", p, true), 409)
	saved.Cron = "@daily"
	expectStatus(t, f.request("PUT", "/api/v1/backups/policy", saved, true), 400)
	backup := decodeResponse[settings.Backup](t, f.request("POST", "/api/v1/backups", nil, true), 201)
	if backup.Status != "succeeded" || backup.Trigger != "manual" || backup.ExpiresAt != nil {
		t.Fatal(backup)
	}
	response := f.request("GET", "/api/v1/backups/"+backup.ID+"/download", nil, true)
	if response.StatusCode != 200 || response.Header.Get("Content-Type") != "application/octet-stream" {
		t.Fatal(response.StatusCode, response.Header)
	}
	payload, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || int64(len(payload)) != backup.Size || strings.Contains(string(payload), "SQLite format") {
		t.Fatal("invalid download", err)
	}
	for _, query := range []string{"?limit=0", "?limit=101", "?unknown=value", "?limit=1&limit=2", "?after=missing"} {
		expectStatus(t, f.request("GET", "/api/v1/backups"+query, nil, true), 400)
	}
	second := decodeResponse[settings.Backup](t, f.request("POST", "/api/v1/backups", nil, true), 201)
	page := decodeResponse[BackupResponse](t, f.request("GET", "/api/v1/backups?limit=1", nil, true), 200)
	if len(page.Items) != 1 || page.Items[0].ID != second.ID || page.NextCursor == "" {
		t.Fatal(page)
	}
	next := decodeResponse[BackupResponse](t, f.request("GET", "/api/v1/backups?limit=1&after="+page.NextCursor, nil, true), 200)
	if len(next.Items) != 1 || next.Items[0].ID != backup.ID || next.NextCursor != "" {
		t.Fatal(next)
	}
	expectStatus(t, f.request("DELETE", "/api/v1/backups/"+backup.ID, nil, true), 204)
	expectStatus(t, f.request("GET", "/api/v1/backups/"+backup.ID+"/download", nil, true), 404)
	expectStatus(t, f.request("GET", "/api/v1/backups/policy", nil, false), 401)
	for _, role := range []string{"viewer", "operator"} {
		t.Run(role, func(t *testing.T) {
			f := setup(t, role)
			enableSettings(t, f)
			for _, path := range []string{"/api/v1/backups/policy", "/api/v1/backups/" + backup.ID + "/download"} {
				expectStatus(t, f.request("GET", path, nil, true), 403)
			}
			expectStatus(t, f.request("PUT", "/api/v1/backups/policy", p, true), 403)
			expectStatus(t, f.request("DELETE", "/api/v1/backups/"+backup.ID, nil, true), 403)
		})
	}
}
