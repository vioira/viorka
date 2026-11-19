package proxy

import (
	_ "embed"
	"slices"
	"strings"
)

//go:embed geo/geosite.txt
var siteSnapshot string

//go:embed geo/geoip.txt
var ipSnapshot string

// GeoCatalog records the revision and available codes of one immutable rule-set source.
type GeoCatalog struct {
	Revision string   `json:"revision"`
	Codes    []string `json:"codes"`
	BuiltIn  []string `json:"built_in"`
}

func parseGeoCatalog(snapshot string, builtIn ...string) GeoCatalog {
	revision, body, _ := strings.Cut(snapshot, "\n")
	return GeoCatalog{Revision: revision, Codes: strings.Fields(body), BuiltIn: append([]string{}, builtIn...)}
}

var siteCatalog = parseGeoCatalog(siteSnapshot)
var ipCatalog = parseGeoCatalog(ipSnapshot, "private")

type RoutingGeoCatalog struct {
	Geosite GeoCatalog `json:"geosite"`
	Geoip   GeoCatalog `json:"geoip"`
}

func SingBoxGeoCatalog() RoutingGeoCatalog {
	return RoutingGeoCatalog{Geosite: siteCatalog, Geoip: ipCatalog}
}

func (c GeoCatalog) containsAll(codes []string) bool {
	for _, code := range codes {
		if _, ok := slices.BinarySearch(c.Codes, code); !ok && !slices.Contains(c.BuiltIn, code) {
			return false
		}
	}
	return true
}
