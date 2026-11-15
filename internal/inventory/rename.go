package inventory

import (
	"context"
	"github.com/vioira/viorka/internal/auth"
	"strings"
)

// Rename uses a compare-and-swap to reject a stale editor without changing identity.
func Rename(ctx context.Context, repo Repository, actor, id, name, expected string) error {
	name = strings.TrimSpace(name)
	if id == "" || len(id) > 128 || !auth.ValidName(name, 128) || !auth.ValidName(expected, 128) {
		return auth.ErrInvalid
	}
	return repo.RenameNode(ctx, actor, id, name, expected)
}
