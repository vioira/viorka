package settings

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/vioira/viorka/internal/auth"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
)

const maxSnapshot = 256 << 20

var backupID = regexp.MustCompile(`^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{64}$`)

type SnapshotStore interface {
	Backup(context.Context, string) error
	AuditSystem(context.Context, string, string, string) error
}
type Backup struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	Size      int64     `json:"size"`
}
type Backups struct {
	mu       sync.Mutex
	dir      string
	store    SnapshotStore
	validate func(context.Context, string) error
}

func NewBackups(path string, store SnapshotStore, validate func(context.Context, string) error) (*Backups, error) {
	dir := path + ".backups"
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	info, e := os.Lstat(dir)
	if e != nil {
		return nil, e
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("backup directory must be private")
	}
	return &Backups{dir: dir, store: store, validate: validate}, nil
}
func (b *Backups) key() (cipher.AEAD, error) {
	path := filepath.Join(b.dir, "encryption.key")
	f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e == nil {
		key := make([]byte, 32)
		if _, e = rand.Read(key); e == nil {
			_, e = f.Write(key)
		}
		if e == nil {
			e = f.Sync()
		}
		closeErr := f.Close()
		if e != nil {
			return nil, e
		}
		if closeErr != nil {
			return nil, closeErr
		}
	} else if !errors.Is(e, os.ErrExist) {
		return nil, e
	}
	info, e := os.Lstat(path)
	if e != nil {
		return nil, e
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("invalid backup key permissions")
	}
	key, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("invalid backup key")
	}
	block, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	return cipher.NewGCM(block)
}
func (b *Backups) List() ([]Backup, error) {
	entries, e := os.ReadDir(b.dir)
	if e != nil {
		return nil, e
	}
	out := []Backup{}
	for _, entry := range entries {
		name := entry.Name()
		if filepath.Ext(name) != ".backup" {
			continue
		}
		id := name[:len(name)-7]
		if !backupID.MatchString(id) {
			continue
		}
		info, e := entry.Info()
		if e != nil {
			return nil, e
		}
		if !info.Mode().IsRegular() {
			continue
		}
		t, e := time.Parse("20060102T150405Z", id[:16])
		if e != nil {
			continue
		}
		out = append(out, Backup{id, t, info.Size()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out, nil
}
func (b *Backups) Create(ctx context.Context, actor string) (Backup, error) {
	if !b.mu.TryLock() {
		return Backup{}, auth.ErrConflict
	}
	defer b.mu.Unlock()
	list, e := b.List()
	if e != nil {
		return Backup{}, e
	}
	if len(list) >= 100 {
		return Backup{}, auth.ErrConflict
	}
	id := time.Now().UTC().Format("20060102T150405Z") + "-" + auth.Random()
	raw := filepath.Join(b.dir, id+".sqlite")
	defer os.Remove(raw)
	if e = b.store.Backup(ctx, raw); e != nil {
		return Backup{}, e
	}
	info, e := os.Stat(raw)
	if e != nil {
		return Backup{}, e
	}
	if info.Size() > maxSnapshot {
		return Backup{}, fmt.Errorf("snapshot exceeds size limit")
	}
	if e = b.validate(ctx, raw); e != nil {
		return Backup{}, e
	}
	data, e := os.ReadFile(raw)
	if e != nil {
		return Backup{}, e
	}
	aead, e := b.key()
	if e != nil {
		return Backup{}, e
	}
	nonce := make([]byte, aead.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return Backup{}, e
	}
	payload := aead.Seal(nonce, nonce, data, []byte(id))
	if e = ctx.Err(); e != nil {
		return Backup{}, e
	}
	path := filepath.Join(b.dir, id+".backup")
	if e = writePrivate(path, payload); e != nil {
		return Backup{}, e
	}
	if e = b.store.AuditSystem(ctx, actor, "backup.create", id); e != nil {
		os.Remove(path)
		return Backup{}, e
	}
	t, _ := time.Parse("20060102T150405Z", id[:16])
	return Backup{id, t, int64(len(payload))}, nil
}
func writePrivate(path string, data []byte) error {
	f, e := os.CreateTemp(filepath.Dir(path), ".pending-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(data); e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	// Link atomically publishes the complete file without overwriting an existing target.
	if e = os.Link(f.Name(), path); e != nil {
		return e
	}
	dir, e := os.Open(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer dir.Close()
	return dir.Sync()
}

func (b *Backups) decrypt(ctx context.Context, id, target string) error {
	if !backupID.MatchString(id) {
		return auth.ErrInvalid
	}
	path := filepath.Join(b.dir, id+".backup")
	info, e := os.Lstat(path)
	if errors.Is(e, os.ErrNotExist) {
		return auth.ErrNotFound
	}
	if e != nil {
		return e
	}
	if !info.Mode().IsRegular() || info.Size() > maxSnapshot+1024 {
		return auth.ErrInvalid
	}
	data, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	aead, e := b.key()
	if e != nil {
		return e
	}
	n := aead.NonceSize()
	if len(data) < n {
		return auth.ErrInvalid
	}
	raw, e := aead.Open(nil, data[:n], data[n:], []byte(id))
	if e != nil {
		return auth.ErrInvalid
	}
	if e = writePrivate(target, raw); e != nil {
		return e
	}
	if e = b.validate(ctx, target); e != nil {
		os.Remove(target)
		return e
	}
	return nil
}
func (b *Backups) Pending() (string, error) {
	data, e := os.ReadFile(filepath.Join(b.dir, "restore.json"))
	if errors.Is(e, os.ErrNotExist) {
		return "", nil
	}
	if e != nil {
		return "", e
	}
	var id string
	if e = json.Unmarshal(data, &id); e != nil {
		return "", e
	}
	if !backupID.MatchString(id) {
		return "", auth.ErrInvalid
	}
	return id, nil
}
func (b *Backups) PrepareRestore(ctx context.Context, actor, id string) error {
	if !b.mu.TryLock() {
		return auth.ErrConflict
	}
	defer b.mu.Unlock()
	if pending, e := b.Pending(); e != nil {
		return e
	} else if pending != "" {
		return auth.ErrConflict
	}
	test := filepath.Join(b.dir, "validate-"+auth.Random()+".sqlite")
	defer os.Remove(test)
	if e := b.decrypt(ctx, id, test); e != nil {
		return e
	}
	if e := b.store.AuditSystem(ctx, actor, "backup.restore.schedule", id); e != nil {
		return e
	}
	data, _ := json.Marshal(id)
	return writePrivate(filepath.Join(b.dir, "restore.json"), data)
}
func (b *Backups) CancelRestore(ctx context.Context, actor string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if e := b.store.AuditSystem(ctx, actor, "backup.restore.cancel", ""); e != nil {
		return e
	}
	e := os.Remove(filepath.Join(b.dir, "restore.json"))
	if errors.Is(e, os.ErrNotExist) {
		return nil
	}
	return e
}

// ApplyPending is only called before opening the live database or accepting connections.
func (b *Backups) ApplyPending(ctx context.Context, path string, prepare func(context.Context, string) error, checkpoint func(context.Context, string) error) error {
	id, e := b.Pending()
	if e != nil || id == "" {
		return e
	}
	target := path + ".restoring-" + auth.Random()
	defer os.Remove(target)
	if e = b.decrypt(ctx, id, target); e != nil {
		return e
	}
	if e = prepare(ctx, target); e != nil {
		return e
	}
	if e = checkpoint(ctx, path); e != nil {
		return e
	}
	// Recovery copies include the WAL; no running process may own this database.
	suffix := ".before-restore-" + time.Now().UTC().Format("20060102T150405.000000000")
	for _, ext := range []string{"", "-wal", "-shm"} {
		source := path + ext
		info, e := os.Lstat(source)
		if errors.Is(e, os.ErrNotExist) {
			continue
		}
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() {
			return auth.ErrInvalid
		}
		if e = copyPrivate(source, path+suffix+ext); e != nil {
			return e
		}
	}
	for _, ext := range []string{"-wal", "-shm"} {
		if e = os.Remove(path + ext); e != nil && !errors.Is(e, os.ErrNotExist) {
			return e
		}
	}
	if e = os.Rename(target, path); e != nil {
		return e
	}
	return os.Remove(filepath.Join(b.dir, "restore.json"))
}
func (b *Backups) Prune() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	list, e := b.List()
	if e != nil {
		return e
	}
	pending, e := b.Pending()
	if e != nil {
		return e
	}
	for _, v := range list {
		if v.ID != pending && time.Since(v.CreatedAt) > 14*24*time.Hour {
			if e = os.Remove(filepath.Join(b.dir, v.ID+".backup")); e != nil {
				return e
			}
		}
	}
	return nil
}

func copyPrivate(source, target string) error {
	in, e := os.Open(source)
	if e != nil {
		return e
	}
	defer in.Close()
	out, e := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	if _, e = io.Copy(out, in); e == nil {
		e = out.Sync()
	}
	closeErr := out.Close()
	if e != nil {
		os.Remove(target)
		return e
	}
	return closeErr
}
