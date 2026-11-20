package storage

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/subscription"
)

func TestSubscriptionTemplateImpactAndRestore(t *testing.T) {
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	if err := s.SetEngineGrant(ctx, "admin", "node", proxy.Grant{UserID: "operator", CanExport: true}); err != nil {
		t.Fatal(err)
	}
	sub, _, err := s.SaveSubscription(ctx, "operator", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	edit.Name = "unrelated"
	edit.RuleIDs = []string{"sing-box"}
	unrelated, _, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	page, err := s.SubscriptionTemplateImpact(ctx, "admin", "mihomo", "", 1)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != sub.ID || page.NextCursor != "" {
		t.Fatalf("wrong impact: %+v %v", page, err)
	}
	if _, err = s.SubscriptionTemplateImpact(ctx, "operator", "mihomo", "", 1); !errors.Is(err, subscription.ErrForbidden) {
		t.Fatal("impact visible to operator", err)
	}
	current, err := adminTemplate(ctx, s.db, "admin", "mihomo")
	if err != nil {
		t.Fatal(err)
	}
	change := subscription.TemplateEdit{Name: current.Name, Body: current.Body, Format: current.Format, Version: current.Version, ExpectedReferences: current.References, Confirm: true,
		Script: `if (config.includes("example.net") || config.includes("example.com")) throw "unmasked"; if (!config.includes("node / one") || !config.includes("node-1.example.invalid")) throw "missing representative node"; return config + "# " + context.params.test + "\n";`}
	check, err := s.CompareSubscriptionTemplate(ctx, "admin", "mihomo", sub.ID, change, subscription.TemplateRequest{Params: map[string]string{"test": "test-diff"}})
	if err != nil || check.BeforeInvalid || check.AfterInvalid || !check.Changed || check.Before != "" || check.After != "# test-diff\n" || check.Services != 1 {
		t.Fatalf("comparison: %+v %v", check, err)
	}
	access, err := s.SubscriptionAccess(ctx, "admin", sub.ID)
	if err != nil || len(access) != 0 {
		t.Fatal("preview recorded as download", err)
	}
	if _, err = s.CompareSubscriptionTemplate(ctx, "admin", "mihomo", unrelated.ID, change, subscription.TemplateRequest{}); !errors.Is(err, subscription.ErrNotFound) {
		t.Fatal("compared unrelated subscription", err)
	}
	if err = s.SetEngineGrant(ctx, "admin", "node", proxy.Grant{UserID: "operator"}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CompareSubscriptionTemplate(ctx, "admin", "mihomo", sub.ID, change, subscription.TemplateRequest{}); !errors.Is(err, subscription.ErrForbidden) {
		t.Fatal("owner lost authorization", err)
	}

	updated, err := s.SaveSubscriptionTemplate(ctx, "admin", "mihomo", change)
	if err != nil {
		t.Fatal(err)
	}
	req := subscription.TemplateRestore{Version: updated.Version, SourceVersion: current.Version, ExpectedReferences: current.References, Confirm: true}
	if _, err := s.RestoreSubscriptionTemplate(ctx, "operator", "mihomo", req); !errors.Is(err, subscription.ErrForbidden) {
		t.Fatal("operator restored version", err)
	}
	restored, err := s.RestoreSubscriptionTemplate(ctx, "admin", "mihomo", req)
	if err != nil || restored.Version != updated.Version+1 || restored.Script != current.Script || restored.Body != current.Body {
		t.Fatal("restore lost content or revision", err)
	}
	if _, err = s.RestoreSubscriptionTemplate(ctx, "admin", "mihomo", req); !errors.Is(err, subscription.ErrConflict) {
		t.Fatal("stale restore accepted", err)
	}
	revs, err := s.SubscriptionTemplateHistory(ctx, "admin", "mihomo")
	if err != nil || len(revs.Items) != 2 || revs.Items[0].Version != updated.Version {
		t.Fatal("history", revs, err)
	}
	replaced, err := s.SubscriptionTemplateVersion(ctx, "admin", "mihomo", updated.Version)
	if err != nil || replaced.Script != change.Script {
		t.Fatal("restore discarded replaced version", err)
	}
	var audits int
	if err := s.db.QueryRow(`SELECT count(*) FROM audit_logs WHERE action='subscription.template.restore'`).Scan(&audits); err != nil || audits != 1 {
		t.Fatal("restore audit", audits, err)
	}
}

func TestSubscriptionTemplateHistoryRetentionAndSnapshot(t *testing.T) {
	ctx := context.Background()
	s, _ := publishedSubscriptionFixture(t)
	base, err := adminTemplate(ctx, s.db, "admin", "mihomo")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 12; i++ {
		base, err = s.SaveSubscriptionTemplate(ctx, "admin", base.ID, subscription.TemplateEdit{Name: base.Name, Format: base.Format, Body: base.Body, Version: base.Version, ExpectedReferences: base.References, Confirm: true, Script: `return config; // ` + strings.Repeat("a", i+1)})
		if err != nil {
			t.Fatal(err)
		}
	}
	revs, err := s.SubscriptionTemplateHistory(ctx, "admin", base.ID)
	if err != nil || len(revs.Items) != 10 || revs.Items[9].Version != 3 {
		t.Fatalf("retention: %v %v", revs, err)
	}
	file := filepath.Join(t.TempDir(), "snapshot.db")
	if err = s.Backup(ctx, file); err != nil {
		t.Fatal(err)
	}
	if err = PrepareRestoredSnapshot(ctx, file); err != nil {
		t.Fatal(err)
	}
	if err = ValidateSnapshot(ctx, file); err != nil {
		t.Fatal(err)
	}
	backup, err := snapshotDB(file, true)
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	var version int64
	var script string
	if err = backup.QueryRowContext(ctx, `SELECT version,script FROM subscription_template_history WHERE template_id=? ORDER BY version DESC LIMIT 1`, base.ID).Scan(&version, &script); err != nil || version != 12 || script != `return config; // `+strings.Repeat("a", 11) {
		t.Fatal("history lost on restore", version, err)
	}
}
