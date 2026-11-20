package httpapi

import (
	"testing"

	"github.com/vioira/viorka/internal/subscription"
)

func TestSubscriptionTemplateHistoryHTTP(t *testing.T) {
	f := setup(t, "admin")
	const base = "/api/v1/subscription-templates/mihomo"
	all := decodeResponse[SubscriptionTemplatesResponse](t, f.request("GET", "/api/v1/subscription-templates", nil, true), 200)
	var source subscription.Template
	for _, t := range all.Items {
		if t.ID == "mihomo" {
			source = t
		}
	}
	change := subscription.TemplateEdit{Name: source.Name, Format: source.Format, Body: source.Body + "\n# added", ExpectedReferences: source.References, Version: source.Version, Confirm: true}
	updated := decodeResponse[subscription.Template](t, f.request("PUT", base, change, true), 200)
	history := decodeResponse[subscription.TemplateRevisions](t, f.request("GET", base+"/history", nil, true), 200)
	if len(history.Items) != 1 || history.Items[0].Version != source.Version {
		t.Fatal("missing historical version")
	}
	prior := decodeResponse[subscription.Template](t, f.request("GET", base+"/history/1", nil, true), 200)
	if prior.Body != source.Body {
		t.Fatal("history differs from original")
	}
	expectStatus(t, f.request("GET", base+"/history/a", nil, true), 400)
	expectStatus(t, f.request("GET", base+"/impact?limit=0", nil, true), 400)
	impact := decodeResponse[subscription.TemplateImpactPage](t, f.request("GET", base+"/impact", nil, true), 200)
	if len(impact.Items) != 0 {
		t.Fatal("unexpected subscriptions")
	}
	expectStatus(t, f.request("GET", base+"/impact", nil, false), 401)
	operator := setup(t, "operator")
	expectStatus(t, operator.request("GET", base+"/history/1", nil, true), 403)
	expectStatus(t, operator.request("POST", base+"/compare", SubscriptionTemplateComparisonRequest{}, true), 403)
	req := subscription.TemplateRestore{Version: updated.Version, SourceVersion: prior.Version, ExpectedReferences: source.References, Confirm: true}
	result := decodeResponse[subscription.Template](t, f.request("POST", base+"/restore", req, true), 200)
	if result.Body != source.Body || result.Version != updated.Version+1 {
		t.Fatal("failed to restore template")
	}
	expectStatus(t, f.request("POST", base+"/restore", req, true), 409)
}
