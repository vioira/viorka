package storage

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/subscription"
)

func TestSubscriptionTemplatesDefaultsAndReferences(t *testing.T) {
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	templates, err := s.SubscriptionTemplates(ctx, "admin")
	if err != nil || len(templates) != 3 {
		t.Fatalf("defaults: %v %v", templates, err)
	}
	var mihomo subscription.Template
	for _, template := range templates {
		if template.ID == "mihomo" {
			mihomo = template
		}
		preview, err := subscription.PreviewTemplate(ctx, subscription.TemplateEdit{Name: template.Name, Format: template.Format, Body: template.Body, Replacements: template.Replacements}, subscription.TemplateRequest{Params: map[string]string{"support-x25519mlkem768": "true"}})
		if err != nil {
			t.Fatalf("default %s: %v", template.ID, err)
		}
		if template.ID == "loon" && !strings.Contains(string(preview.Body), "chrome147") {
			t.Fatal("Loon conditional replacement missing")
		}
	}
	_, token, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	change := subscription.TemplateEdit{Name: mihomo.Name, Format: mihomo.Format, Body: strings.Replace(mihomo.Body, "enable: false", "enable: true\n  nameserver: [1.1.1.1]", 1), Version: mihomo.Version, ExpectedReferences: mihomo.References}
	if _, err = s.SaveSubscriptionTemplate(ctx, "operator", mihomo.ID, change); !errors.Is(err, subscription.ErrForbidden) {
		t.Fatalf("operator edited template: %v", err)
	}
	if _, err = s.SaveSubscriptionTemplate(ctx, "admin", mihomo.ID, change); !errors.Is(err, subscription.ErrConflict) {
		t.Fatalf("shared edit without confirmation: %v", err)
	}
	change.Confirm = true
	change.ExpectedReferences++
	if _, err = s.SaveSubscriptionTemplate(ctx, "admin", mihomo.ID, change); !errors.Is(err, subscription.ErrConflict) {
		t.Fatalf("stale references accepted: %v", err)
	}
	change.ExpectedReferences = mihomo.References
	updated, err := s.SaveSubscriptionTemplate(ctx, "admin", mihomo.ID, change)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveSubscriptionTemplate(ctx, "admin", mihomo.ID, change); !errors.Is(err, subscription.ErrConflict) {
		t.Fatalf("stale version: %v", err)
	}
	output, err := s.FetchSubscription(ctx, token, "clash-verge", "")
	if err != nil || !strings.Contains(string(output.Body), "nameserver: [1.1.1.1]") {
		t.Fatalf("saved template not used: %s %v", output.Body, err)
	}
	if err = s.DeleteSubscriptionTemplate(ctx, "admin", updated.ID, updated.Version); !errors.Is(err, subscription.ErrConflict) {
		t.Fatal("builtin deleted", err)
	}
	// A second template of the same format is selected through its rule, not by format alone.
	custom, err := s.SaveSubscriptionTemplate(ctx, "admin", "", subscription.TemplateEdit{Name: "custom", Format: mihomo.Format, Body: mihomo.Body, Script: `return config + "# custom " + context.params.flavor + "\n";`})
	if err != nil {
		t.Fatal(err)
	}
	rule, err := s.SaveSubscriptionRule(ctx, "admin", "", subscription.RuleEdit{Name: "custom", TemplateID: custom.ID, Conditions: []subscription.Condition{{Kind: "contains", Pattern: "custom"}}, Position: 10, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	edit.Name = "custom"
	edit.RuleIDs = []string{rule.ID}
	_, customToken, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	output, err = s.FetchSubscription(ctx, customToken, "custom", "", map[string]string{"flavor": "test"})
	if err != nil || !strings.Contains(string(output.Body), "# custom test") {
		t.Fatalf("rule template not used: %s %v", output.Body, err)
	}
	output, err = s.FetchSubscription(ctx, customToken, "unknown", "mihomo", map[string]string{"flavor": "explicit"})
	if err != nil || !strings.Contains(string(output.Body), "# custom explicit") {
		t.Fatalf("override template not used: %s %v", output.Body, err)
	}
	if err = s.DeleteSubscriptionTemplate(ctx, "admin", custom.ID, custom.Version); !errors.Is(err, subscription.ErrConflict) {
		t.Fatal("referenced template deleted", err)
	}
	if _, err = s.SaveSubscriptionRule(ctx, "admin", "", subscription.RuleEdit{Name: "missing", TemplateID: "missing", Position: 1}); !errors.Is(err, subscription.ErrInvalid) {
		t.Fatal("missing template accepted", err)
	}
}
func TestSubscriptionTemplateCRUDAndFailureLogging(t *testing.T) {
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	templates, err := s.SubscriptionTemplates(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	source := templates[0]
	item, err := s.SaveSubscriptionTemplate(ctx, "admin", "", subscription.TemplateEdit{Name: "temporary", Format: source.Format, Body: source.Body})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteSubscriptionTemplate(ctx, "admin", item.ID, item.Version); err != nil {
		t.Fatal(err)
	}
	// Failing scripts never produce a successful response or success access record.
	var template subscription.Template
	for _, v := range templates {
		if v.ID == "mihomo" {
			template = v
		}
	}
	_, err = s.SaveSubscriptionTemplate(ctx, "admin", template.ID, subscription.TemplateEdit{Name: template.Name, Format: template.Format, Body: template.Body, Script: `throw new Error(config);`, Version: template.Version, ExpectedReferences: template.References, Confirm: true})
	if err != nil {
		t.Fatal(err)
	}
	itemSub, token, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.FetchSubscription(ctx, token, "clash-verge", "")
	if !errors.Is(err, subscription.ErrInvalid) || len(out.Body) != 0 || strings.Contains(err.Error(), "uuid") {
		t.Fatal("script failure leaked output", err)
	}
	access, err := s.SubscriptionAccess(ctx, "admin", itemSub.ID)
	if err != nil || len(access) != 1 || access[0].Result != "unavailable" {
		t.Fatalf("failure not recorded: %v %v", access, err)
	}
}
