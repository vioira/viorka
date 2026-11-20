package storage

import (
	"context"
	"errors"
	"testing"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/subscription"
)

func TestSubscriptionFinalAccessAfterRotation(t *testing.T) {
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	item, original, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	current, err := s.RotateSubscription(ctx, "admin", item.ID, item.Version, false)
	if err != nil {
		t.Fatal(err)
	}

	// Reproduce the final write of a download whose first read preceded rotation.
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	err = recordSubscriptionAccessTx(ctx, tx, item.ID, auth.Hash(original), "client", "", subscription.Mihomo, "ok")
	if !errors.Is(err, subscription.ErrNotFound) {
		t.Fatalf("old token passed the final check: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	records, err := s.SubscriptionAccess(ctx, "admin", item.ID)
	if err != nil || len(records) != 0 {
		t.Fatalf("stale download left an access record: %v %v", records, err)
	}
	if _, err := s.FetchSubscription(ctx, current, "client", subscription.Mihomo); err != nil {
		t.Fatal(err)
	}
	records, err = s.SubscriptionAccess(ctx, "admin", item.ID)
	if err != nil || len(records) != 1 || records[0].Result != "ok" {
		t.Fatalf("current token did not record its download: %v %v", records, err)
	}
}
