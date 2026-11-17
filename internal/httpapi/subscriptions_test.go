package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/subscription"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestSubscriptionHTTPDownloadAndRevocation(t *testing.T) {
	f := setup(t, "admin")
	ctx := context.Background()
	node, _ := f.enroll()
	if err := f.store.Online(ctx, node, v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability}}); err != nil {
		t.Fatal(err)
	}
	expectStatus(t, f.request("POST", "/api/v1/nodes/"+node+"/engines", InstallEngineRequest{Name: "sing-box", IdempotencyKey: "subscription-install", Confirm: true}, true), 202)
	install, err := f.store.ClaimEngines(ctx, node)
	if err != nil || install == nil {
		t.Fatal("claim install", err)
	}
	reply := func(dispatch *v1.TaskDispatch, status string) {
		t.Helper()
		err := f.store.Reply(ctx, node, "task.result", v1.TaskReply{TaskID: dispatch.TaskID, ResourceID: dispatch.ResourceID, Attempt: *dispatch.Attempt, State: "succeeded", Engine: &v1.EngineResult{Name: dispatch.Engine.Name, Version: dispatch.Engine.Version, Revision: dispatch.Engine.Revision, Status: status}})
		if err != nil {
			t.Fatal(err)
		}
	}
	reply(install, "installed")
	draft, err := f.store.SaveEngineDraft(ctx, "user", install.ResourceID, proxy.Draft{Services: []proxy.Service{{ID: "selected", Name: "测试服务", Enabled: true, ListenHost: "0.0.0.0", ListenPort: 8443, TargetHost: "example.com", TargetPort: 443, ServerName: "example.com", PublicHost: "example.net", PublicPort: 443}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.store.EngineAction(ctx, "user", install.ResourceID, proxy.Action{Operation: "engine.apply", DraftVersion: draft.Version, IdempotencyKey: "subscription-apply", Confirm: true}); err != nil {
		t.Fatal(err)
	}
	apply, err := f.store.ClaimEngines(ctx, node)
	if err != nil || apply == nil {
		t.Fatal("claim apply", err)
	}
	reply(apply, "running")
	edit := subscription.Edit{Name: "客户端", Port: 7890, RuleIDs: []string{"mihomo", "sing-box"}, Services: []subscription.ServiceRef{{NodeID: node, EngineID: install.ResourceID, ServiceID: "selected"}}}
	expectStatus(t, f.request("POST", "/api/v1/subscriptions", edit, false), 401)
	res := f.request("POST", "/api/v1/subscriptions", edit, true)
	if res.StatusCode != 201 || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("create %d: %s", res.StatusCode, read(res))
	}
	var issued SubscriptionIssuedResponse
	if err := json.NewDecoder(res.Body).Decode(&issued); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	link, err := url.Parse(issued.URL)
	if err != nil || link.RawQuery != "" || !strings.HasPrefix(link.Path, "/api/v1/subscription-links/") || issued.FormatURLs["sing-box"] == "" {
		t.Fatalf("issued links: %+v %v", issued, err)
	}
	get := func(path, ua string) *http.Response {
		t.Helper()
		r, err := http.NewRequest("GET", f.server.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("User-Agent", ua)
		res, err := f.server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	res = get(link.Path, "Clash-Verge/2")
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/yaml") || res.Header.Get("Cache-Control") != "private, no-store" || res.Header.Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(read(res), "测试服务") {
		t.Fatal("Mihomo download did not return selected service with protected headers")
	}
	res = get(link.Path+"?format=sing-box", "unknown")
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
		t.Fatalf("explicit format: %d %s", res.StatusCode, read(res))
	}
	res.Body.Close()
	expectStatus(t, get(link.Path, "unknown"), 406)
	expectStatus(t, get(link.Path+"?format=loon", "unknown"), 406)
	expectStatus(t, get(link.Path+"?format=mihomo&format=sing-box", "unknown"), 400)
	expectStatus(t, f.request("POST", "/api/v1/subscriptions/"+issued.Subscription.ID+"/rotate", SubscriptionVersionRequest{Version: issued.Subscription.Version + 1}, true), 409)
	rotated := decodeResponse[SubscriptionIssuedResponse](t, f.request("POST", "/api/v1/subscriptions/"+issued.Subscription.ID+"/rotate", SubscriptionVersionRequest{Version: issued.Subscription.Version}, true), 200)
	expectStatus(t, get(link.Path, "Clash-Verge/2"), 404)
	newLink, err := url.Parse(rotated.URL)
	if err != nil {
		t.Fatal(err)
	}
	expectStatus(t, get(newLink.Path, "Clash-Verge/2"), 200)
	expectStatus(t, f.request("POST", "/api/v1/subscriptions/"+issued.Subscription.ID+"/revoke", SubscriptionVersionRequest{Version: rotated.Subscription.Version}, true), 200)
	expectStatus(t, get(newLink.Path, "Clash-Verge/2"), 404)
}

func TestSubscriptionHTTPViewerPermissions(t *testing.T) {
	f := setup(t, "viewer")
	expectStatus(t, f.request("GET", "/api/v1/subscription-rules", nil, true), 200)
	expectStatus(t, f.request("GET", "/api/v1/subscriptions", nil, true), 200)
	expectStatus(t, f.request("POST", "/api/v1/subscriptions", subscription.Edit{}, true), 403)
	expectStatus(t, f.request("POST", "/api/v1/subscription-rules", subscription.RuleEdit{}, true), 403)
	expectStatus(t, f.request("GET", "/api/v1/subscription-recovery", nil, true), 403)
}

func TestSubscriptionTemplateHTTP(t *testing.T) {
	f := setup(t, "admin")
	expectStatus(t, f.request("GET", "/api/v1/subscription-templates", nil, false), 401)
	templates := decodeResponse[SubscriptionTemplatesResponse](t, f.request("GET", "/api/v1/subscription-templates", nil, true), 200)
	if len(templates.Items) != 3 {
		t.Fatal("missing default templates")
	}
	var loon subscription.Template
	for _, v := range templates.Items {
		if v.Format == subscription.Loon {
			loon = v
		}
	}
	edit := subscription.TemplateEdit{Name: "Loon custom", Format: loon.Format, Body: loon.Body, Replacements: loon.Replacements}
	created := decodeResponse[subscription.Template](t, f.request("POST", "/api/v1/subscription-templates", edit, true), 201)
	preview := decodeResponse[SubscriptionTemplatePreviewResponse](t, f.request("POST", "/api/v1/subscription-templates/preview", SubscriptionTemplatePreviewRequest{Template: edit, Request: subscription.TemplateRequest{Params: map[string]string{"support-x25519mlkem768": "true"}}}, true), 200)
	if !strings.Contains(preview.Body, "chrome147") {
		t.Fatal("conditional replacement not applied")
	}
	edit.Script = "return 123;"
	expectStatus(t, f.request("POST", "/api/v1/subscription-templates/preview", SubscriptionTemplatePreviewRequest{Template: edit}, true), 400)
	expectStatus(t, f.request("DELETE", "/api/v1/subscription-templates/"+created.ID, SubscriptionVersionRequest{Version: created.Version}, true), 204)
	operator := setup(t, "operator")
	expectStatus(t, operator.request("POST", "/api/v1/subscription-templates", edit, true), 403)
	expectStatus(t, operator.request("POST", "/api/v1/subscription-templates/preview", SubscriptionTemplatePreviewRequest{Template: edit}, true), 403)
}
