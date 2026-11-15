package auth

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestRegistrationName(t *testing.T) {
	for _, v := range []struct{ name, prefix, hostname, want string }{
		{"explicit", "hk-", "hostname", "explicit"},
		{"", "hk-", "hostname", "hk-hostname"},
		{"", "hk-", "", "hk-abcdefghijkl"},
	} {
		if got := RegistrationName(v.name, v.prefix, v.hostname, "abcdefghijklmnopqrstuvwxyz"); got != v.want {
			t.Fatalf("got %q want %q", got, v.want)
		}
	}
	result := RegistrationName("", "hk-", strings.Repeat("中", 80), "abcdefghijkl")
	if !utf8.ValidString(result) || len(result) > 128 || !strings.HasPrefix(result, "hk-") {
		t.Fatal("unsafe generated name", result)
	}
	for _, value := range []string{"", strings.Repeat("中", 43), "bad\x00name", "bad\nname", string([]byte{255})} {
		if ValidName(value, 128) {
			t.Fatalf("accepted invalid name %q", value)
		}
	}
}
