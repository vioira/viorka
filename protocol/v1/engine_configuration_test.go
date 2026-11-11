package v1

import (
	"strings"
	"testing"
)

func TestNativeConfigurationPreservesCredentials(t *testing.T) {
	config := &EngineConfiguration{Revision: 1, Files: []*EngineConfigFile{{Name: "config.json", Content: `{"inbounds":[{"clients":[{"id":"credential-uuid"}],"realitySettings":{"privateKey":"private-secret","shortIds":["abcdef"]}}],"outbounds":[{"username":"account","password":"pass-secret","uuid":"exit-uuid","server":"example.com"}]}`}}}
	if err := ValidateEngineConfiguration("xray", config); err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"credential-uuid", "private-secret", "abcdef", "account", "pass-secret", "exit-uuid"} {
		if !strings.Contains(config.Files[0].Content, secret) {
			t.Fatalf("credential removed: %s", secret)
		}
	}
	if !strings.Contains(config.Files[0].Content, "example.com") {
		t.Fatal("non-secret configuration lost")
	}
	config.Files[0].Name = "../config.json"
	if ValidateEngineConfiguration("xray", config) == nil {
		t.Fatal("path accepted")
	}
	config.Files[0].Name = "config.json"
	config.Files[0].Content = strings.Repeat(" ", MaxEngineConfigurationBytes+1)
	if ValidateEngineConfiguration("xray", config) == nil {
		t.Fatal("unbounded configuration accepted")
	}
}

func TestConfigurationRequestOnlyInspect(t *testing.T) {
	c := EngineCommand{Name: "realm", Version: EngineVersion("realm"), Revision: 1, RunIntent: "running", IncludeConfig: true}
	if c.Validate("engine.inspect") != nil {
		t.Fatal("valid read rejected")
	}
	if c.Validate("engine.stop") == nil {
		t.Fatal("config read flag accepted for mutation")
	}
}
