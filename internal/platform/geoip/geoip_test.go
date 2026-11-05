package geoip

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMissingAndInvalidDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "City.mmdb")
	if r, err := Open(path); err == nil {
		r.Close()
		t.Fatal("missing file accepted")
	}
	if err := os.WriteFile(path, []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if r, err := Open(path); err == nil {
		r.Close()
		t.Fatal("corrupt file accepted")
	}
}
func TestLocalizedNames(t *testing.T) {
	if got := localized(map[string]string{"zh-CN": "东京", "en": "Tokyo"}); got != "东京" {
		t.Fatal(got)
	}
	if got := localized(map[string]string{"en": "Tokyo"}); got != "Tokyo" {
		t.Fatal(got)
	}
	if got := localized(nil); got != "" {
		t.Fatal(got)
	}
}

func TestCityDatabaseLookup(t *testing.T) {
	resolver, err := Open("testdata/GeoIP2-City-Test.mmdb")
	if err != nil {
		t.Fatal(err)
	}
	defer resolver.Close()
	location, err := resolver.Lookup("81.2.69.160")
	if err != nil || location.CountryCode != "GB" || location.City != "伦敦" || location.Subdivision != "英格兰" {
		t.Fatalf("%+v %v", location, err)
	}
	missing, err := resolver.Lookup("1.1.1.1")
	if err != nil || missing.CountryCode != "" || missing.City != "" {
		t.Fatalf("unknown address invented a location: %+v %v", missing, err)
	}
}
