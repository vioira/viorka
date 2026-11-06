package storage

import (
	"context"
	"encoding/json"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/internal/settings"
)

func (s *Store) BackupPolicy(ctx context.Context) (settings.BackupPolicy, error) {
	var p settings.BackupPolicy
	var raw, secret string
	err := s.db.QueryRowContext(ctx, `SELECT revision,enabled,cron,retention_days,max_copies,s3_json,secret_encrypted FROM backup_policy WHERE id=1`).Scan(&p.Revision, &p.Enabled, &p.Cron, &p.RetentionDays, &p.MaxCopies, &raw, &secret)
	if err != nil {
		return p, err
	}
	if err = json.Unmarshal([]byte(raw), &p.S3); err != nil {
		return p, err
	}
	if secret != "" {
		var data []byte
		data, err = s.openEngine("backup-s3", secret)
		p.S3.SecretKey = string(data)
	}
	return p, err
}
func (s *Store) SaveBackupPolicy(ctx context.Context, actor string, p settings.BackupPolicy) error {
	secret := ""
	var err error
	if p.S3.SecretKey != "" {
		secret, err = s.sealEngine("backup-s3", []byte(p.S3.SecretKey))
		if err != nil {
			return err
		}
	}
	p.S3.SecretKey = ""
	p.S3.SecretConfigured = false
	raw, err := json.Marshal(p.S3)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE backup_policy SET revision=revision+1,enabled=?,cron=?,retention_days=?,max_copies=?,s3_json=?,secret_encrypted=? WHERE id=1 AND revision=?`, p.Enabled, p.Cron, p.RetentionDays, p.MaxCopies, string(raw), secret, p.Revision)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return auth.ErrConflict
	}
	if err = audit(ctx, tx, actor, "backup.policy.update", "backup", "policy"); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE system_settings SET auto_backup=?,revision=revision+1 WHERE id=1`, p.Enabled); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "settings"})
}
