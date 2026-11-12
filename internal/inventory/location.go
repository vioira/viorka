package inventory

import (
	"context"
	"log/slog"
	"net/netip"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

// Location is the reported public exit IP's approximate location, not a host address.
type Location struct {
	CountryCode string `json:"country_code"`
	Subdivision string `json:"subdivision"`
	City        string `json:"city"`
}

type LocationCandidate struct {
	ID, IP   string
	Location Location
}
type LocationRepository interface {
	LocationCandidates(context.Context, string, int) ([]LocationCandidate, error)
	SaveLocation(context.Context, string, string, Location) error
}
type LocationResolver interface {
	Lookup(string) (Location, error)
}

// LocationIP uses the same special-use exclusions as the Agent protocol.
func LocationIP(ipv4, ipv6 string) string {
	for i, raw := range []string{ipv4, ipv6} {
		if v1.PublicAddress(raw, i == 0) {
			addr, err := netip.ParseAddr(raw)
			if err == nil {
				return addr.Unmap().String()
			}
		}
	}
	return ""
}

type NodeLocationResolver interface {
	LookupContext(context.Context, string) (Location, error)
}

type locationCacheEntry struct {
	location Location
	attempts int
	done     bool
}

// RunLocations owns a single bounded worker. The persisted address table is the
// recovery source, so a restart cannot lose work. No external I/O occurs in SQL transactions.
func RunLocations(ctx context.Context, repo LocationRepository, resolver NodeLocationResolver) {
	cache := map[string]locationCacheEntry{}
	after := ""
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		work, cancel := context.WithTimeout(ctx, 4*time.Second)
		candidates, err := repo.LocationCandidates(work, after, 100)
		if err == nil {
			for _, c := range candidates {
				if work.Err() != nil {
					break
				}
				location, ready := lookupLocation(work, cache, resolver, c.IP)
				if ready && location != c.Location {
					if err = repo.SaveLocation(work, c.ID, c.IP, location); err != nil {
						break
					}
				}
				after = c.ID
			}
			if len(candidates) < 100 {
				after = ""
			}
		}
		if err != nil && ctx.Err() == nil {
			slog.Warn("node location refresh failed")
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// Cache successful misses too. Corrupt records are retried at most three times
// per cache residency; replacing the database and restarting resets the cache.
func lookupLocation(ctx context.Context, cache map[string]locationCacheEntry, resolver NodeLocationResolver, ip string) (Location, bool) {
	if ip == "" {
		return Location{}, true
	}
	entry := cache[ip]
	if !entry.done && entry.attempts < 3 {
		entry.attempts++
		var err error
		entry.location, err = resolver.LookupContext(ctx, ip)
		if ctx.Err() != nil {
			return Location{}, false
		}
		entry.done = err == nil
		if _, exists := cache[ip]; !exists && len(cache) >= 4096 {
			clear(cache)
		}
		cache[ip] = entry
		if err != nil {
			slog.Warn("node location lookup failed", "attempt", entry.attempts)
		}
	}
	return entry.location, entry.done
}
