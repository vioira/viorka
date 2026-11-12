// Package geoip reads a locally provisioned MaxMind City database and provides
// an optional IPinfo fallback for node locations. It does not download databases.
package geoip

import (
	"context"
	"fmt"
	"net"
	"strings"

	"github.com/oschwald/geoip2-golang"
	"github.com/vioira/viorka/internal/inventory"
)

type Resolver struct{ db *geoip2.Reader }

func Open(path string) (*Resolver, error) {
	db, err := geoip2.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open GeoIP database: %w", err)
	}
	if !strings.Contains(db.Metadata().DatabaseType, "City") {
		db.Close()
		return nil, fmt.Errorf("GeoIP database must be a MaxMind City database")
	}
	return &Resolver{db: db}, nil
}
func (r *Resolver) Close() error { return r.db.Close() }
func (r *Resolver) Lookup(ip string) (inventory.Location, error) {
	record, err := r.db.City(net.ParseIP(ip))
	if err != nil {
		return inventory.Location{}, fmt.Errorf("lookup GeoIP: %w", err)
	}
	location := inventory.Location{CountryCode: record.Country.IsoCode, City: localized(record.City.Names)}
	if len(record.Subdivisions) > 0 {
		location.Subdivision = localized(record.Subdivisions[0].Names)
	}
	return location, nil
}
func localized(names map[string]string) string {
	if names["zh-CN"] != "" {
		return names["zh-CN"]
	}
	return names["en"]
}

func (r *Resolver) LookupContext(_ context.Context, ip string) (inventory.Location, error) {
	return r.Lookup(ip)
}
