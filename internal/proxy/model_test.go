package proxy

import "testing"

func TestListenerConflictSemantics(t *testing.T) {
	for _, tc := range []struct {
		a, b string
		want bool
	}{{"0.0.0.0", "127.0.0.1", true}, {"::", "127.0.0.1", true}, {"::1", "127.0.0.1", false}, {"127.0.0.1", "127.0.0.2", false}, {"::ffff:127.0.0.1", "127.0.0.1", true}} {
		if PortsConflict(tc.a, 443, tc.b, 443) != tc.want {
			t.Fatalf("%+v", tc)
		}
		if PortsConflict(tc.a, 443, tc.b, 444) {
			t.Fatal("different ports")
		}
	}
}
func TestDraftValidationRejectsUnsafeEndpoints(t *testing.T) {
	base := Service{ID: "rule", Name: "TCP rule", Enabled: true, ListenHost: "127.0.0.1", ListenPort: 1234, TargetHost: "example.com", TargetPort: 443}
	if ValidateDraft("realm", Draft{Services: []Service{base}}) != nil {
		t.Fatal("valid")
	}
	for _, mutate := range []func(*Service){func(s *Service) { s.TargetHost = "example.com;shutdown" }, func(s *Service) { s.TargetHost = "127.0.0.1"; s.TargetPort = 1234 }, func(s *Service) { s.ListenHost = "fe80::1%eth0" }, func(s *Service) { s.ListenPort = 65536 }, func(s *Service) { s.PublicHost = "example.com" }, func(s *Service) { s.ID = "../../service" }} {
		s := base
		mutate(&s)
		if ValidateDraft("realm", Draft{Services: []Service{s}}) == nil {
			t.Fatalf("accepted %+v", s)
		}
	}
}
