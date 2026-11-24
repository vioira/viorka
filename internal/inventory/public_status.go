package inventory

import (
	"github.com/vioira/viorka/internal/auth"
	"regexp"
	"strings"
	"time"
)

type NodeCategory struct {
	ID     string `json:"id"`
	Kind   string `json:"kind" enum:"group,tag"`
	Name   string `json:"name" maxLength:"64"`
	Shared bool   `json:"shared"`
}
type CategoryCatalog struct {
	Revision int64          `json:"revision" minimum:"1"`
	Items    []NodeCategory `json:"items" maxItems:"256"`
}
type CategoryAssignment struct {
	Revision int64    `json:"revision" minimum:"1"`
	Nodes    []string `json:"nodes" minItems:"1" maxItems:"256"`
	Action   string   `json:"action" enum:"group,add,remove"`
	Category string   `json:"category"`
}
type PublishedNode struct {
	ID       string `json:"id"`
	Alias    string `json:"alias" maxLength:"96"`
	CPUCores *int   `json:"cpu_cores,omitempty" minimum:"1" maximum:"65536"`
}
type StatusPublication struct {
	Revision int64           `json:"revision" minimum:"1"`
	Enabled  bool            `json:"enabled"`
	Nodes    []PublishedNode `json:"nodes" maxItems:"128"`
}
type TrafficLifetime struct {
	Start   time.Time `json:"start"`
	RX      string    `json:"rx"`
	TX      string    `json:"tx"`
	Partial bool      `json:"partial"`
}
type ExchangeQuote struct {
	Date string  `json:"date"`
	Rate float64 `json:"rate"`
}
type ExchangeRates struct {
	Day    string                   `json:"day"`
	Quotes map[string]ExchangeQuote `json:"quotes"`
}

var categoryID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func (c CategoryCatalog) Validate() error {
	if c.Revision < 1 || c.Items == nil || len(c.Items) > 256 {
		return auth.ErrInvalid
	}
	ids, names := map[string]bool{}, map[string]bool{}
	for _, item := range c.Items {
		key := item.Kind + "/" + strings.ToLower(item.Name)
		if !categoryID.MatchString(item.ID) || ids[item.ID] || names[key] || (item.Kind != "tag" && item.Kind != "group") || !statusName(item.Name, 64) {
			return auth.ErrInvalid
		}
		ids[item.ID], names[key] = true, true
	}
	return nil
}
func statusName(s string, max int) bool {
	return len(s) > 0 && len([]rune(s)) <= max && s == strings.TrimSpace(s) && !strings.ContainsAny(s, "\r\n\t\x00")
}
func (p StatusPublication) Validate() error {
	if p.Revision < 1 || p.Nodes == nil || len(p.Nodes) > 128 || p.Enabled && len(p.Nodes) == 0 {
		return auth.ErrInvalid
	}
	ids := map[string]bool{}
	for _, n := range p.Nodes {
		if !categoryID.MatchString(n.ID) || ids[n.ID] || !statusName(n.Alias, 96) || n.CPUCores != nil && (*n.CPUCores < 1 || *n.CPUCores > 65536) {
			return auth.ErrInvalid
		}
		ids[n.ID] = true
	}
	return nil
}
