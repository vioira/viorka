package geoip

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/vioira/viorka/internal/inventory"
)

// IPInfoFallback uses the legacy /json endpoint, where authentication is optional.
// It is only wired into node lookups, never login source lookups.
type IPInfoFallback struct {
	local  inventory.LocationResolver
	token  string
	client *http.Client
}

func NewIPInfoFallback(local inventory.LocationResolver, token string) *IPInfoFallback {
	return &IPInfoFallback{local: local, token: token, client: &http.Client{
		Timeout:       3 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func (r *IPInfoFallback) LookupContext(ctx context.Context, ip string) (inventory.Location, error) {
	if inventory.LocationIP(ip, ip) == "" {
		return inventory.Location{}, nil
	}
	if r.local != nil {
		location, err := r.local.Lookup(ip)
		if err != nil || location.CountryCode != "" {
			return location, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://ipinfo.io/"+ip+"/json", nil)
	if err != nil {
		return inventory.Location{}, fmt.Errorf("create IPinfo request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if r.token != "" {
		req.Header.Set("Authorization", "Bearer "+r.token)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return inventory.Location{}, fmt.Errorf("query IPinfo: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return inventory.Location{}, fmt.Errorf("IPinfo returned HTTP %d", resp.StatusCode)
	}
	const maxBody = 64 * 1024
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return inventory.Location{}, fmt.Errorf("read IPinfo response: %w", err)
	}
	if len(body) > maxBody {
		return inventory.Location{}, fmt.Errorf("IPinfo response exceeds size limit")
	}
	var record struct {
		Country string          `json:"country"`
		Region  string          `json:"region"`
		City    string          `json:"city"`
		Error   json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(body, &record); err != nil {
		return inventory.Location{}, fmt.Errorf("invalid IPinfo response")
	}
	if len(record.Error) > 0 && string(record.Error) != "null" {
		return inventory.Location{}, fmt.Errorf("IPinfo returned an error")
	}
	if record.Country == "" {
		return inventory.Location{}, nil
	}
	if len(record.Country) != 2 || record.Country[0] < 'A' || record.Country[0] > 'Z' || record.Country[1] < 'A' || record.Country[1] > 'Z' || len(record.Region) > 256 || len(record.City) > 256 {
		return inventory.Location{}, fmt.Errorf("invalid IPinfo location")
	}
	return inventory.Location{CountryCode: record.Country, Subdivision: record.Region, City: record.City}, nil
}
