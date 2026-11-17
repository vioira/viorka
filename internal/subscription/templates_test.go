package subscription

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestTemplateVariablesAndTransforms(t *testing.T) {
	body := "[General]\ndns-server = 1.1.1.1\n[Proxy]\n{{proxies}}\n[Proxy Group]\n自定义 = select, {{proxy_choices}}\n[Rule]\nDOMAIN,example.org,DIRECT\nFINAL,自定义\n"
	template := Template{Format: Loon, Body: body, Replacements: []Replacement{{Pattern: `(tls-profile=|fp=)chrome([,\r\n]|$)`, Replacement: `${1}chrome147${2}`, Parameter: "support-x25519mlkem768", Value: "true"}}, Script: `if (context.userAgent === "Loon/test") { config += "# script\n"; } return config;`}
	for _, enabled := range []bool{false, true} {
		params := map[string]string{}
		if enabled {
			params["support-x25519mlkem768"] = "true"
		}
		result, err := RenderTemplate(context.Background(), template, 7890, previewNodes(), TemplateRequest{UserAgent: "Loon/test", Params: params})
		if err != nil {
			t.Fatal(err)
		}
		output := string(result.Body)
		if strings.Contains(output, "chrome147") != enabled || !strings.Contains(output, "dns-server = 1.1.1.1") || !strings.Contains(output, "自定义 = select, 示例节点, DIRECT") || !strings.Contains(output, "DOMAIN,example.org,DIRECT") || !strings.HasSuffix(output, "# script\n") {
			t.Fatalf("unexpected config: %s", output)
		}
	}
	// User-provided names are data, never a second template evaluation.
	nodes := previewNodes()
	nodes[0].Name = "{{port}}"
	result, err := RenderTemplate(context.Background(), Template{Format: Loon, Body: body}, 7890, nodes, TemplateRequest{})
	if err != nil || !strings.Contains(string(result.Body), "{{port}} = VLESS") {
		t.Fatalf("node name was interpreted: %s %v", result.Body, err)
	}
}
func TestTemplateInvalidOutputAndScripts(t *testing.T) {
	for _, tc := range []struct{ name, body, script string }{
		{"unknown variable", `{"outbounds": [{{unknown}}]}`, ""},
		{"invalid JSON", `{"outbounds": [{{proxies}}]`, ""},
		{"invalid script", `{"outbounds": [{{proxies}}]}`, "return ("},
		{"missing return", `{"outbounds": [{{proxies}}]}`, "config += 'x';"},
		{"invalid final JSON", `{"outbounds": [{{proxies}}]}`, "return 'invalid';"},
		{"no host access", `{"outbounds": [{{proxies}}]}`, "return require('fs').readFileSync('/etc/passwd');"},
		{"infinite loop", `{"outbounds": [{{proxies}}]}`, "while(true) {}"},
		{"oversized output", `{"outbounds": [{{proxies}}]}`, "return ' '.repeat(2100000);"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			started := time.Now()
			_, err := PreviewTemplate(context.Background(), TemplateEdit{Name: "test", Format: SingBox, Body: tc.body, Script: tc.script}, TemplateRequest{})
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("expected invalid template, got %v", err)
			}
			if time.Since(started) > 2*time.Second {
				t.Fatal("script exceeded execution bound")
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := RenderTemplate(ctx, Template{Format: SingBox, Body: `{}`}, 7890, previewNodes(), TemplateRequest{})
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
func TestTemplateRequestAndRegexValidation(t *testing.T) {
	for _, r := range []TemplateRequest{{UserAgent: strings.Repeat("x", 1025)}, {Params: map[string]string{"bad key": "x"}}, {Params: map[string]string{"ok": strings.Repeat("x", 257)}}} {
		if !errors.Is(ValidateTemplateRequest(r), ErrInvalid) {
			t.Fatal("invalid request accepted")
		}
	}
	err := ValidateTemplate(TemplateEdit{Name: "test", Format: SingBox, Body: `{}`, Replacements: []Replacement{{Pattern: "["}}})
	if !errors.Is(err, ErrInvalid) {
		t.Fatal("invalid regex accepted")
	}
}
