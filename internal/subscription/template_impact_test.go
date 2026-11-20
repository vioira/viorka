package subscription

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTemplateComparisonExcerpt(t *testing.T) {
	for _, c := range []struct {
		before, after, old, new string
		start                   int
	}{
		{"first\nold\nlast", "first\nnew\nlast", "old\n", "new\n", 2},
		{"first\nlast\n", "first\nnew\nlast\n", "", "new\n", 2},
		{"first\nold\nlast\n", "first\nlast\n", "old\n", "", 2},
		{"first", "first\n", "first", "first\n", 1},
	} {
		r := CompareTemplateOutput([]byte(c.before), []byte(c.after))
		if !r.Changed || r.Before != c.old || r.After != c.new || r.StartLine != c.start || r.Truncated {
			t.Fatalf("mismatched range: %+v", r)
		}
	}
	r := CompareTemplateOutput(nil, []byte(strings.Repeat("变", 8192)))
	if !r.Truncated || len(r.After) > 16384 || !utf8.ValidString(r.After) {
		t.Fatal("oversized excerpt")
	}
}

func TestTemplateComparisonMasksConnectionFields(t *testing.T) {
	secret := "sensitive"
	node := ClientNode{ServiceRef: ServiceRef{NodeID: "node", EngineID: "engine", ServiceID: "service"}, Name: "label", Host: secret, Port: 1080, UUID: secret, ServerName: secret, PublicKey: secret, ShortID: secret}
	masked := MaskTemplateNodes([]ClientNode{node})[0]
	if masked.Name != node.Name || masked.Host == node.Host || masked.Port == node.Port || masked.UUID == node.UUID || masked.ServerName == node.ServerName || masked.PublicKey == node.PublicKey || masked.ShortID == node.ShortID {
		t.Fatal("comparison exposes connection settings")
	}
}
