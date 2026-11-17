package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/subscription"
)

func publishedSubscriptionFixture(t *testing.T) (*Store, subscription.Edit) {
	t.Helper()
	s := engineFixture(t)
	draft := saveEngine(t, s, "sing", proxy.Draft{Services: []proxy.Service{sampleService("one", 8443), sampleService("two", 9443)}})
	dispatch := actionEngine(t, s, "sing", "initial-subscription-apply", "engine.apply", draft.Version)
	replyEngine(t, s, dispatch, "running")
	return s, subscription.Edit{Name: "手机", Port: 7890, RuleIDs: []string{"mihomo", "sing-box"}, Services: []subscription.ServiceRef{{NodeID: "node", EngineID: "sing", ServiceID: "one"}}}
}

func TestSubscriptionTokenRulesAndBoundedAccess(t *testing.T) {
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	item, token, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil || len(token) != 64 || item.Revoked || len(item.Services) != 1 || item.Services[0].Status != "available" {
		t.Fatalf("create: %+v %q %v", item, token, err)
	}
	var stored string
	if err = s.db.QueryRow(`SELECT token_hash FROM subscriptions WHERE id=?`, item.ID).Scan(&stored); err != nil || stored != auth.Hash(token) || stored == token {
		t.Fatal("token was not hashed", err)
	}
	result, err := s.FetchSubscription(ctx, token, "clash-verge/v2", "")
	if err != nil || !strings.Contains(string(result.Body), "node / one") || strings.Contains(string(result.Body), "node / two") {
		t.Fatalf("wrong selected services: %s %v", result.Body, err)
	}
	result, err = s.FetchSubscription(ctx, token, "unknown", subscription.SingBox)
	if err != nil || result.ContentType != "application/json; charset=utf-8" {
		t.Fatalf("explicit format: %v", err)
	}
	if _, err = s.FetchSubscription(ctx, token, "unrecognized", ""); !errors.Is(err, subscription.ErrUnsupported) {
		t.Fatalf("unknown client accepted: %v", err)
	}
	for i := 0; i < 25; i++ {
		if _, err = s.FetchSubscription(ctx, token, "test "+token, subscription.Mihomo); err != nil {
			t.Fatal(err)
		}
	}
	logs, err := s.SubscriptionAccess(ctx, "admin", item.ID)
	if err != nil || len(logs) != 20 {
		t.Fatalf("access retention: %d %v", len(logs), err)
	}
	for _, log := range logs {
		if strings.Contains(log.UserAgent, token) {
			t.Fatal("access log contains token")
		}
		if log.RuleID != "" || log.Format != subscription.Mihomo {
			t.Fatal("explicit format was misreported as a User-Agent rule match")
		}
	}
	rotated, err := s.RotateSubscription(ctx, "admin", item.ID, item.Version, false)
	if err != nil || rotated == token || len(rotated) != 64 {
		t.Fatal("rotate", err)
	}
	if _, err = s.FetchSubscription(ctx, token, "clash-verge", ""); !errors.Is(err, subscription.ErrNotFound) {
		t.Fatalf("old token survived rotation: %v", err)
	}
	if _, err = s.FetchSubscription(ctx, rotated, "clash-verge", ""); err != nil {
		t.Fatal(err)
	}
	if _, err = s.RotateSubscription(ctx, "admin", item.ID, item.Version+1, true); err != nil {
		t.Fatal(err)
	}
	if _, err = s.FetchSubscription(ctx, rotated, "clash-verge", ""); !errors.Is(err, subscription.ErrNotFound) {
		t.Fatalf("revoked token survived: %v", err)
	}
}

func TestSubscriptionPermissionsAreRechecked(t *testing.T) {
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	if _, _, err := s.SaveSubscription(ctx, "operator", "", edit); !errors.Is(err, subscription.ErrForbidden) {
		t.Fatalf("operator without export permission: %v", err)
	}
	if err := s.SetEngineGrant(ctx, "admin", "node", proxy.Grant{UserID: "operator", CanExport: true}); err != nil {
		t.Fatal(err)
	}
	item, token, err := s.SaveSubscription(ctx, "operator", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Subscription(ctx, "viewer", item.ID); !errors.Is(err, subscription.ErrForbidden) {
		t.Fatalf("unrelated viewer read subscription: %v", err)
	}
	if _, err = s.FetchSubscription(ctx, token, "clash-verge", ""); err != nil {
		t.Fatal(err)
	}
	if err = s.SetEngineGrant(ctx, "admin", "node", proxy.Grant{UserID: "operator"}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.FetchSubscription(ctx, token, "clash-verge", ""); !errors.Is(err, subscription.ErrForbidden) {
		t.Fatalf("revoked export permission not enforced: %v", err)
	}
}

func TestSubscriptionSharedRuleRequiresCurrentImpactConfirmation(t *testing.T) {
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	_, firstToken, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	edit.Name = "平板"
	_, secondToken, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	rules, err := s.SubscriptionRules(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	var rule subscription.Rule
	for _, candidate := range rules {
		if candidate.ID == "mihomo" {
			rule = candidate
		}
	}
	change := subscription.RuleEdit{Name: rule.Name, TemplateID: rule.TemplateID, Conditions: []subscription.Condition{{Kind: "contains", Pattern: "flclash"}}, Position: rule.Position, Version: rule.Version, ExpectedReferences: 2, Enabled: true}
	if _, err = s.SaveSubscriptionRule(ctx, "admin", rule.ID, change); !errors.Is(err, subscription.ErrConflict) {
		t.Fatalf("shared rule changed without confirmation: %v", err)
	}
	change.Confirm, change.ExpectedReferences = true, 1
	if _, err = s.SaveSubscriptionRule(ctx, "admin", rule.ID, change); !errors.Is(err, subscription.ErrConflict) {
		t.Fatalf("stale impact count accepted: %v", err)
	}
	change.ExpectedReferences = 2
	if _, err = s.SaveSubscriptionRule(ctx, "operator", rule.ID, change); !errors.Is(err, subscription.ErrForbidden) {
		t.Fatalf("operator changed global rule: %v", err)
	}
	updated, err := s.SaveSubscriptionRule(ctx, "admin", rule.ID, change)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteSubscriptionRule(ctx, "admin", rule.ID, updated.Version); !errors.Is(err, subscription.ErrConflict) {
		t.Fatalf("referenced rule deleted: %v", err)
	}
	for _, token := range []string{firstToken, secondToken} {
		if _, err = s.FetchSubscription(ctx, token, "FlClash/1", ""); err != nil {
			t.Fatalf("updated application rule not applied: %v", err)
		}
	}
}

func TestSubscriptionRetainsPublishedServicesWhenStopped(t *testing.T) {
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	_, token, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	stopped := actionEngine(t, s, "sing", "stop-for-subscription", "engine.stop", 0)
	replyEngine(t, s, stopped, "stopped")
	result, err := s.FetchSubscription(ctx, token, "clash-verge", "")
	if err != nil || !strings.Contains(string(result.Body), "node / one") {
		t.Fatalf("stopping the engine removed its published service: %s %v", result.Body, err)
	}
}

func TestSubscriptionConfirmedDeletionAndRestore(t *testing.T) {
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	edit.Services = append(edit.Services, subscription.ServiceRef{NodeID: "node", EngineID: "sing", ServiceID: "two"})
	item, token, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	engine, err := s.Engine(ctx, "admin", "sing")
	if err != nil {
		t.Fatal(err)
	}
	engine.Draft.Services[0].PendingDelete = true
	draft := saveEngine(t, s, "sing", engine.Draft)
	dispatch := actionEngine(t, s, "sing", "delete-one", "engine.apply", draft.Version)
	before, err := s.FetchSubscription(ctx, token, "clash-verge", "")
	if err != nil || !strings.Contains(string(before.Body), "node / one") {
		t.Fatal("unconfirmed deletion changed output", err)
	}
	replyEngine(t, s, dispatch, "running")
	after, err := s.FetchSubscription(ctx, token, "clash-verge", "")
	if err != nil || strings.Contains(string(after.Body), "node / one") || !strings.Contains(string(after.Body), "node / two") {
		t.Fatalf("confirmed deletion not applied: %s %v", after.Body, err)
	}
	got, err := s.Subscription(ctx, "admin", item.ID)
	if err != nil || got.Services[0].Status != "invalid" || got.Services[1].Status != "available" {
		t.Fatalf("wrong service status: %+v %v", got.Services, err)
	}
	// Reusing the same service ID must not silently revive a removed selection.
	engine, err = s.Engine(ctx, "admin", "sing")
	if err != nil {
		t.Fatal(err)
	}
	engine.Draft.Services = append(engine.Draft.Services, sampleService("one", 8443))
	draft = saveEngine(t, s, "sing", engine.Draft)
	recreated := actionEngine(t, s, "sing", "recreate-one", "engine.apply", draft.Version)
	replyEngine(t, s, recreated, "running")
	after, err = s.FetchSubscription(ctx, token, "clash-verge", "")
	if err != nil || strings.Contains(string(after.Body), "node / one") || !strings.Contains(string(after.Body), "node / two") {
		t.Fatalf("recreated service inherited an invalid selection: %s %v", after.Body, err)
	}
	edit.Version = got.Version
	edit.Reselect = []subscription.ServiceRef{edit.Services[0]}
	updated, _, err := s.SaveSubscription(ctx, "admin", item.ID, edit)
	if err != nil || updated.Services[0].Status != "available" {
		t.Fatalf("explicit re-selection failed: %+v %v", updated.Services, err)
	}
	edit.Version = updated.Version
	if _, _, err = s.SaveSubscription(ctx, "admin", item.ID, edit); !errors.Is(err, subscription.ErrInvalid) {
		t.Fatalf("a valid selection was incorrectly accepted as a re-selection: %v", err)
	}
	after, err = s.FetchSubscription(ctx, token, "clash-verge", "")
	if err != nil || !strings.Contains(string(after.Body), "node / one") || !strings.Contains(string(after.Body), "node / two") {
		t.Fatalf("explicitly selected service was not exported: %s %v", after.Body, err)
	}

	path := filepath.Join(t.TempDir(), "snapshot.db")
	if err = s.Backup(ctx, path); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".engine-key", s.engineKey, 0600); err != nil {
		t.Fatal(err)
	}
	if err = PrepareRestoredSnapshot(ctx, path); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if _, err = restored.FetchSubscription(ctx, token, "clash-verge", ""); !errors.Is(err, subscription.ErrNotFound) {
		t.Fatalf("snapshot revived token: %v", err)
	}
	restoredItem, err := restored.Subscription(ctx, "admin", item.ID)
	if err != nil || !restoredItem.Revoked || restoredItem.Services[1].Status != "pending" {
		t.Fatalf("restored state: %+v %v", restoredItem, err)
	}
	newToken, err := restored.RotateSubscription(ctx, "admin", item.ID, restoredItem.Version, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restored.FetchSubscription(ctx, newToken, "clash-verge", ""); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatalf("unverified restored service was exported: %v", err)
	}
}

func TestSubscriptionNodeDeletionPermanentlyInvalidatesSelections(t *testing.T) {
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	item, token, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteNode(ctx, "admin", "node"); err != nil {
		t.Fatal(err)
	}
	var invalidated bool
	if err = s.db.QueryRow(`SELECT invalidated FROM subscription_service_links WHERE subscription_id=?`, item.ID).Scan(&invalidated); err != nil || !invalidated {
		t.Fatalf("node deletion did not tombstone selection: %v", err)
	}
	if _, err = s.FetchSubscription(ctx, token, "clash-verge", ""); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatalf("deleted node still exported: %v", err)
	}
}
