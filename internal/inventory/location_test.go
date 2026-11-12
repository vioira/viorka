package inventory

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestLocationIP(t *testing.T) {
	for _, test := range []struct{ v4, v6, want string }{
		{"8.8.8.8", "2606:4700:4700::1111", "8.8.8.8"},
		{"10.0.0.1", "2606:4700:4700:0:0:0:0:1111", "2606:4700:4700::1111"},
		{"100.64.1.1", "2001:db8::1", ""},
		{"127.0.0.1", "::1", ""},
		{"203.0.113.1", "fc00::1", ""},
		{"", "", ""},
	} {
		if got := LocationIP(test.v4, test.v6); got != test.want {
			t.Errorf("%+v: %s", test, got)
		}
	}
}

type testLocationRepo struct {
	saved  []Location
	cancel context.CancelFunc
}

func (r *testLocationRepo) LocationCandidates(context.Context, string, int) ([]LocationCandidate, error) {
	return []LocationCandidate{{ID: "one", IP: "8.8.8.8"}, {ID: "two", IP: "8.8.8.8"}, {ID: "three", Location: Location{CountryCode: "US"}}}, nil
}
func (r *testLocationRepo) SaveLocation(_ context.Context, _, _ string, l Location) error {
	r.saved = append(r.saved, l)
	if len(r.saved) == 3 {
		r.cancel()
	}
	return nil
}

type testLocationResolver struct{ calls int }

func (r *testLocationResolver) LookupContext(context.Context, string) (Location, error) {
	r.calls++
	return Location{CountryCode: "US"}, nil
}
func TestLocationWorkerCachesAndStops(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	repo := &testLocationRepo{cancel: cancel}
	resolver := &testLocationResolver{}
	RunLocations(ctx, repo, resolver)
	if resolver.calls != 1 || len(repo.saved) != 3 || repo.saved[0].CountryCode != "US" || repo.saved[2] != (Location{}) {
		t.Fatalf("calls=%d saved=%+v", resolver.calls, repo.saved)
	}
}

type failedLocationResolver struct{ calls int }

func (r *failedLocationResolver) LookupContext(context.Context, string) (Location, error) {
	r.calls++
	return Location{}, errors.New("bad database record")
}
func TestLocationLookupFailureBounded(t *testing.T) {
	cache := map[string]locationCacheEntry{}
	resolver := &failedLocationResolver{}
	for range 10 {
		if _, ready := lookupLocation(context.Background(), cache, resolver, "8.8.8.8"); ready {
			t.Fatal("lookup failure reported success")
		}
	}
	if resolver.calls != 3 {
		t.Fatalf("unbounded retries: %d", resolver.calls)
	}
	for range 10 {
		if _, ready := lookupLocation(context.Background(), cache, resolver, ""); !ready {
			t.Fatal("empty address unresolved")
		}
	}
	if resolver.calls != 3 {
		t.Fatal("empty address sent to resolver")
	}
}
