package alerts

import (
	"math"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/vioira/viorka/internal/auth"
)

const Builtin = "node-offline"
const DefaultTemplate = "default"

type Rule struct {
	Since         int64    `json:"effective_ms,omitempty"`
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Metric        string   `json:"metric" enum:"cpu,memory,disk,upload,download,offline,monthly"`
	Mode          string   `json:"mode" enum:"average,all,duration,gb,percent"`
	Threshold     float64  `json:"threshold"`
	WindowMinutes int      `json:"window_minutes"`
	RepeatMinutes int      `json:"repeat_minutes"`
	Enabled       bool     `json:"enabled"`
	Recovery      bool     `json:"recovery"`
	Nodes         []string `json:"nodes"`
	Channels      []string `json:"channels"`
	Template      string   `json:"template"`
}
type Channel struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Kind   string `json:"kind" enum:"telegram,bark"`
	Target string `json:"target"`
}
type Message struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}
type Template struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Trigger  Message `json:"trigger"`
	Repeat   Message `json:"repeat"`
	Recovery Message `json:"recovery"`
}
type Config struct {
	Revision  int        `json:"revision"`
	Timezone  string     `json:"timezone"`
	Rules     []Rule     `json:"rules"`
	Channels  []Channel  `json:"channels"`
	Templates []Template `json:"templates"`
}
type Edit struct {
	Config  Config            `json:"config"`
	Secrets map[string]string `json:"secrets,omitempty"`
}
type DeliveryStatus struct {
	State  string `json:"state"`
	At     string `json:"at"`
	Detail string `json:"detail"`
}
type View struct {
	Config      Config                    `json:"config"`
	Delivery    map[string]DeliveryStatus `json:"delivery"`
	Credentials map[string]bool           `json:"credentials"`
}

var safeID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)
var chatID = regexp.MustCompile(`^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,32})$`)
var botToken = regexp.MustCompile(`^[0-9]+:[A-Za-z0-9_-]+$`)
var barkKey = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func (c Channel) ValidSecret(v string) bool {
	return len(v) <= 256 && ((c.Kind == "telegram" && botToken.MatchString(v)) || (c.Kind == "bark" && barkKey.MatchString(v)))
}
func (r Rule) Applies(node string) bool {
	return r.Enabled && (len(r.Nodes) == 0 || slices.Contains(r.Nodes, node))
}
func (r Rule) SameCondition(other Rule) bool {
	return r.Enabled == other.Enabled && r.Metric == other.Metric && r.Mode == other.Mode && r.WindowMinutes == other.WindowMinutes && r.Threshold == other.Threshold && slices.Equal(r.Nodes, other.Nodes)
}
func named(id, name string) bool {
	return safeID.MatchString(id) && strings.TrimSpace(name) != "" && len(name) <= 128
}
func unique(ids []string, allowed map[string]bool) bool {
	seen := map[string]bool{}
	for _, id := range ids {
		if !safeID.MatchString(id) || seen[id] || (allowed != nil && !allowed[id]) {
			return false
		}
		seen[id] = true
	}
	return true
}
func (c Config) Validate() error {
	if c.Rules == nil || c.Channels == nil || c.Templates == nil || c.Revision < 1 || c.Timezone == "" || c.Timezone == "Local" || len(c.Timezone) > 80 || len(c.Rules) > 64 || len(c.Channels) > 24 || len(c.Templates) > 32 {
		return auth.ErrInvalid
	}
	if _, e := time.LoadLocation(c.Timezone); e != nil {
		return auth.ErrInvalid
	}
	channels := map[string]bool{}
	templates := map[string]bool{}
	rules := map[string]bool{}
	for _, ch := range c.Channels {
		if !named(ch.ID, ch.Name) || channels[ch.ID] {
			return auth.ErrInvalid
		}
		channels[ch.ID] = true
		switch ch.Kind {
		case "telegram":
			if !chatID.MatchString(ch.Target) {
				return auth.ErrInvalid
			}
		case "bark":
			u, e := url.Parse(ch.Target)
			if e != nil || len(ch.Target) > 512 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Trim(u.Path, "/") != "" {
				return auth.ErrInvalid
			}
		default:
			return auth.ErrInvalid
		}
	}
	for _, t := range c.Templates {
		if !named(t.ID, t.Name) || templates[t.ID] || !t.Valid() {
			return auth.ErrInvalid
		}
		templates[t.ID] = true
	}
	for _, r := range c.Rules {
		if r.Nodes == nil || r.Channels == nil || !named(r.ID, r.Name) || rules[r.ID] || !templates[r.Template] || len(r.Nodes) > 512 || !unique(r.Nodes, nil) || !unique(r.Channels, channels) || r.RepeatMinutes < 0 || r.RepeatMinutes > 43200 || math.IsNaN(r.Threshold) || math.IsInf(r.Threshold, 0) || r.Threshold < 0 || r.Threshold > 1e12 {
			return auth.ErrInvalid
		}
		rules[r.ID] = true
		switch r.Metric {
		case "offline":
			if r.Mode != "duration" || r.WindowMinutes < 1 || r.WindowMinutes > 1440 || r.Threshold != 0 {
				return auth.ErrInvalid
			}
		case "monthly":
			if (r.Mode != "gb" && r.Mode != "percent") || r.Threshold <= 0 || r.WindowMinutes != 0 {
				return auth.ErrInvalid
			}
		case "cpu", "memory", "disk", "upload", "download":
			if (r.Mode != "average" && r.Mode != "all") || r.WindowMinutes < 1 || r.WindowMinutes > 60 {
				return auth.ErrInvalid
			}
			if (r.Metric == "cpu" || r.Metric == "disk" || r.Metric == "memory") && r.Threshold > 100 {
				return auth.ErrInvalid
			}
		default:
			return auth.ErrInvalid
		}
		if r.ID == Builtin && (r.Metric != "offline" || !slices.Contains([]int{5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 60}, r.WindowMinutes)) {
			return auth.ErrInvalid
		}
	}
	if !templates[DefaultTemplate] || !rules[Builtin] {
		return auth.ErrInvalid
	}
	return nil
}
func Defaults() Config {
	base := "{node}，{metric}，{basis} {value}，阈值 {threshold}。\n{time}"
	return Config{
		Revision: 1, Timezone: "UTC", Channels: []Channel{},
		Rules: []Rule{{ID: Builtin, Name: "节点离线", Metric: "offline", Mode: "duration", WindowMinutes: 5, Enabled: true, Template: DefaultTemplate, Nodes: []string{}, Channels: []string{}}},
		Templates: []Template{{ID: DefaultTemplate, Name: "默认通知",
			Trigger: Message{"告警：{rule}", base}, Repeat: Message{"持续告警：{rule}", base},
			Recovery: Message{"已恢复：{rule}", "{node}，{metric}已恢复，持续 {duration}。\n{time}"},
		}},
	}
}

type NodeStatus struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	State  string `json:"state"`
	Active bool   `json:"active"`
}
type StatusPage struct {
	Items []NodeStatus `json:"items"`
	Next  string       `json:"next_cursor"`
}
