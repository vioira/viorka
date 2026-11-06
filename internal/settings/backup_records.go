package settings

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/vioira/viorka/internal/auth"
)

type backupRecord struct {
	Backup
	RemoteConfig string `json:"remote_encrypted,omitempty"`
}

func (b *Backups) record(v Backup) error {
	sealed := ""
	if v.Remote != nil {
		aead, err := b.key()
		if err != nil {
			return err
		}
		raw, err := json.Marshal(v.Remote)
		if err != nil {
			return err
		}
		nonce := make([]byte, aead.NonceSize())
		if _, err = rand.Read(nonce); err != nil {
			return err
		}
		sealed = base64.RawStdEncoding.EncodeToString(aead.Seal(nonce, nonce, raw, []byte(v.ID+":s3")))
	}
	data, err := json.Marshal(backupRecord{v, sealed})
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(b.dir, ".record-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(f.Name(), filepath.Join(b.dir, v.ID+".record")); err != nil {
		return err
	}
	dir, err := os.Open(b.dir)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func (b *Backups) List() ([]Backup, error) {
	entries, err := os.ReadDir(b.dir)
	if err != nil {
		return nil, err
	}
	out := []Backup{}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".record" {
			continue
		}
		id := entry.Name()[:len(entry.Name())-7]
		if !backupID.MatchString(id) {
			continue
		}
		v, err := b.readRecord(id)
		if errors.Is(err, auth.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID > out[j].ID
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}
func (b *Backups) readRecord(id string) (Backup, error) {
	if !backupID.MatchString(id) {
		return Backup{}, auth.ErrInvalid
	}
	data, err := os.ReadFile(filepath.Join(b.dir, id+".record"))
	if errors.Is(err, os.ErrNotExist) {
		return Backup{}, auth.ErrNotFound
	}
	if err != nil {
		return Backup{}, err
	}
	var r backupRecord
	if err = json.Unmarshal(data, &r); err != nil {
		return Backup{}, err
	}
	if r.ID != id {
		return Backup{}, auth.ErrInvalid
	}
	if r.RemoteConfig != "" {
		aead, err := b.key()
		if err != nil {
			return Backup{}, err
		}
		sealed, err := base64.RawStdEncoding.DecodeString(r.RemoteConfig)
		if err != nil || len(sealed) < aead.NonceSize() {
			return Backup{}, auth.ErrInvalid
		}
		raw, err := aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], []byte(id+":s3"))
		if err != nil {
			return Backup{}, err
		}
		if err = json.Unmarshal(raw, &r.Backup.Remote); err != nil {
			return Backup{}, err
		}
	}
	return r.Backup, nil
}
func (b *Backups) Create(ctx context.Context, actor string) (Backup, error) {
	if !b.mu.TryLock() {
		return Backup{}, auth.ErrConflict
	}
	defer b.mu.Unlock()
	p, err := b.Policy(ctx)
	if err != nil {
		return Backup{}, err
	}
	now := time.Now().UTC()
	v := Backup{ID: now.Format("20060102T150405Z") + "-" + auth.Random(), CreatedAt: now, Status: "running", Trigger: "manual"}
	v.Filename = v.ID + ".backup"
	if actor == "" {
		v.Trigger = "scheduled"
	}
	if p.RetentionDays > 0 {
		expiry := now.Add(time.Duration(p.RetentionDays) * 24 * time.Hour)
		v.ExpiresAt = &expiry
	}
	if p.S3.Enabled {
		remote := p.S3
		v.Remote = &remote
	}
	if err = b.record(v); err != nil {
		return v, err
	}
	snapshot, err := b.snapshot(ctx, actor, v.ID)
	v.Size = snapshot.Size
	if err == nil && v.Remote != nil {
		err = b.upload(ctx, v, p.S3)
	}
	v.Status = "succeeded"
	if err != nil {
		v.Status = "failed"
	}
	if recordErr := b.record(v); recordErr != nil {
		return v, recordErr
	}
	if err != nil {
		return v, err
	}
	if err = b.prune(ctx, p); err != nil {
		return v, err
	}
	return v, nil
}
func (b *Backups) Delete(ctx context.Context, actor, id string) error {
	if !b.mu.TryLock() {
		return auth.ErrConflict
	}
	defer b.mu.Unlock()
	p, err := b.Policy(ctx)
	if err != nil {
		return err
	}
	return b.remove(ctx, actor, id, p)
}
func (b *Backups) remove(ctx context.Context, actor, id string, p BackupPolicy) error {
	v, err := b.readRecord(id)
	if err != nil {
		return err
	}
	pending, err := b.Pending()
	if err != nil {
		return err
	}
	if id == pending || v.Status == "running" {
		return auth.ErrConflict
	}
	if v.Remote != nil {
		if err = b.deleteRemote(ctx, v, p.S3); err != nil {
			return err
		}
	}
	if err = b.store.AuditSystem(ctx, actor, "backup.delete", id); err != nil {
		return err
	}
	if err = os.Remove(filepath.Join(b.dir, id+".backup")); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Remove(filepath.Join(b.dir, id+".record"))
}
func (b *Backups) Download(id string) (*os.File, error) {
	v, err := b.readRecord(id)
	if err != nil {
		return nil, err
	}
	if v.Status != "succeeded" {
		return nil, auth.ErrConflict
	}
	path := filepath.Join(b.dir, id+".backup")
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, auth.ErrInvalid
	}
	return os.Open(path)
}
func (b *Backups) prune(ctx context.Context, p BackupPolicy) error {
	list, err := b.List()
	if err != nil {
		return err
	}
	pending, err := b.Pending()
	if err != nil {
		return err
	}
	for i, v := range list {
		if v.ID == pending || v.Status == "running" {
			continue
		}
		expired := p.RetentionDays > 0 && !time.Now().Before(v.CreatedAt.Add(time.Duration(p.RetentionDays)*24*time.Hour))
		if expired || (p.MaxCopies > 0 && i >= p.MaxCopies) {
			if err = b.remove(ctx, "", v.ID, p); err != nil {
				return err
			}
		}
	}
	return nil
}
func (b *Backups) Prune() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	b.mu.Lock()
	defer b.mu.Unlock()
	p, err := b.Policy(ctx)
	if err != nil {
		return err
	}
	return b.prune(ctx, p)
}
