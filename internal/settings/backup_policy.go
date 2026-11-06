package settings

import (
	"context"
	"net/url"
	"strings"

	"github.com/robfig/cron/v3"
	"github.com/vioira/viorka/internal/auth"
)

type BackupPolicy struct {
	Revision      int      `json:"revision"`
	Enabled       bool     `json:"enabled"`
	Cron          string   `json:"cron"`
	RetentionDays int      `json:"retention_days" minimum:"0" maximum:"36500"`
	MaxCopies     int      `json:"max_copies" minimum:"0" maximum:"10000"`
	S3            S3Config `json:"s3"`
}
type S3Config struct {
	Enabled          bool   `json:"enabled"`
	Endpoint         string `json:"endpoint"`
	Region           string `json:"region"`
	Bucket           string `json:"bucket"`
	Prefix           string `json:"prefix"`
	AccessKey        string `json:"access_key"`
	SecretKey        string `json:"secret_key,omitempty"`
	SecretConfigured bool   `json:"secret_configured"`
	PathStyle        bool   `json:"path_style"`
}
type BackupPolicyRepository interface {
	BackupPolicy(context.Context) (BackupPolicy, error)
	SaveBackupPolicy(context.Context, string, BackupPolicy) error
}

var cronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

func ValidateBackupPolicy(p BackupPolicy) error {
	if p.Revision < 1 || len(p.Cron) > 128 || len(strings.Fields(p.Cron)) != 5 || p.RetentionDays < 0 || p.RetentionDays > 36500 || p.MaxCopies < 0 || p.MaxCopies > 10000 {
		return auth.ErrInvalid
	}
	if _, err := cronParser.Parse(p.Cron); err != nil {
		return auth.ErrInvalid
	}
	s := p.S3
	if len(s.Endpoint) > 2048 || len(s.Region) > 64 || len(s.Bucket) > 63 || len(s.Prefix) > 512 || len(s.AccessKey) > 256 || len(s.SecretKey) > 4096 {
		return auth.ErrInvalid
	}
	if s.Endpoint != "" {
		u, e := url.Parse(s.Endpoint)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			return auth.ErrInvalid
		}
	}
	if s.Enabled && (s.Region == "" || s.Bucket == "" || s.AccessKey == "" || s.SecretKey == "") {
		return auth.ErrInvalid
	}
	if strings.Contains(s.Bucket, "/") || strings.Contains(s.Prefix, "..") || strings.HasPrefix(s.Prefix, "/") {
		return auth.ErrInvalid
	}
	return nil
}
func (b *Backups) Policy(ctx context.Context) (BackupPolicy, error) {
	if repo, ok := b.store.(BackupPolicyRepository); ok {
		return repo.BackupPolicy(ctx)
	}
	return BackupPolicy{Revision: 1, Enabled: false, Cron: "0 3 * * *", RetentionDays: 14, MaxCopies: 0}, nil
}
func (b *Backups) SavePolicy(ctx context.Context, actor string, p BackupPolicy) (BackupPolicy, error) {
	if !b.mu.TryLock() {
		return p, auth.ErrConflict
	}
	defer b.mu.Unlock()
	old, err := b.Policy(ctx)
	if err != nil {
		return p, err
	}
	if p.S3.SecretKey == "" {
		p.S3.SecretKey = old.S3.SecretKey
	}
	if err = ValidateBackupPolicy(p); err != nil {
		return p, err
	}
	repo, ok := b.store.(BackupPolicyRepository)
	if !ok {
		return p, auth.ErrNotFound
	}
	if err = repo.SaveBackupPolicy(ctx, actor, p); err != nil {
		return p, err
	}
	p.Revision++
	return p, nil
}
func (p BackupPolicy) Public() BackupPolicy {
	p.S3.SecretConfigured = p.S3.SecretKey != ""
	p.S3.SecretKey = ""
	return p
}
