// Package sqlitefixture creates isolated databases for repository and HTTP tests.
package sqlitefixture

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// NewOpener migrates one empty database per package, then opens a private copy
// at each fixture's fresh path. Closing the template checkpoints its WAL.
// Only database bytes are shared: Open generates a new engine key per fixture.
func NewOpener[T io.Closer](open func(context.Context, string) (T, error)) func(*testing.T, context.Context, string) (T, error) {
	var once sync.Once
	var database []byte
	var initErr error
	return func(t *testing.T, ctx context.Context, path string) (T, error) {
		t.Helper()
		once.Do(func() {
			template := filepath.Join(t.TempDir(), "template.db")
			store, err := open(ctx, template)
			if err != nil {
				initErr = err
				return
			}
			if initErr = store.Close(); initErr == nil {
				database, initErr = os.ReadFile(template)
			}
		})
		var zero T
		if initErr != nil {
			return zero, initErr
		}
		if err := os.WriteFile(path, database, 0600); err != nil {
			return zero, err
		}
		return open(ctx, path)
	}
}
