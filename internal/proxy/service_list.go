package proxy

import (
	"net"
	"reflect"
	"strconv"
	"strings"
)

type ServiceListQuery struct {
	After, Selected, Node, Engine, Status, Access, Search string
	Limit                                                 int
}

type ServiceNode struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	State      string `json:"state"`
	LastSeenAt string `json:"last_seen_at"`
	CanManage  bool   `json:"can_manage"`
}

type ServiceEngine struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Version          string `json:"version"`
	Status           string `json:"status"`
	SyncState        string `json:"sync_state"`
	SyncError        string `json:"sync_error"`
	SyncErrorMessage string `json:"sync_error_message"`
	DraftVersion     int64  `json:"draft_version"`
	DesiredRevision  int64  `json:"desired_revision"`
	ObservedRevision int64  `json:"observed_revision"`
}

type ServiceListItem struct {
	ID            string        `json:"id"`
	Node          ServiceNode   `json:"node"`
	Engine        ServiceEngine `json:"engine"`
	Service       Service       `json:"service"`
	Protocol      string        `json:"protocol"`
	PresetName    string        `json:"preset_name"`
	Runtime       string        `json:"runtime" enum:"unknown,running,degraded,stopped,unpublished"`
	Configuration string        `json:"configuration" enum:"pending_delete,draft,failed,pending,synced,unpublished"`
	DraftChanged  bool          `json:"draft_changed"`
	RelayEligible bool          `json:"relay_eligible"`
	Relays        []RelayRoute  `json:"relays"`
}

type ServiceCounts struct {
	All       int `json:"all"`
	Running   int `json:"running"`
	Pending   int `json:"pending"`
	Attention int `json:"attention"`
}

type ServiceList struct {
	Items             []ServiceListItem `json:"items"`
	Selected          *ServiceListItem  `json:"selected,omitempty"`
	NextCursor        string            `json:"next_cursor,omitempty"`
	Counts            ServiceCounts     `json:"counts"`
	Nodes             []ServiceNode     `json:"nodes"`
	Restricted        bool              `json:"restricted"`
	ManagedRelayCount int               `json:"managed_relay_count"`
}

func DescribeService(node ServiceNode, e Engine, svc Service, published *Service, presetName, protocol string) ServiceListItem {
	r := ServiceListItem{
		ID: e.ID + "/" + svc.ID, Node: node, Service: svc, PresetName: presetName, Protocol: protocol,
		Engine: ServiceEngine{
			ID: e.ID, Name: e.Name, Version: e.Version, Status: e.Status,
			SyncState: e.SyncState, SyncError: e.SyncError, SyncErrorMessage: e.SyncErrorMessage,
			DraftVersion: e.Draft.Version, DesiredRevision: e.DesiredRevision, ObservedRevision: e.ObservedRevision,
		},
		Runtime: "unknown", Relays: []RelayRoute{},
	}
	if node.State == "online" && e.LastError != "engine_external" {
		switch {
		case published == nil:
			r.Runtime = "unpublished"
		case e.ObservedRevision != e.PublishedRevision:
			r.Runtime = "unknown"
		case !published.Enabled || published.PendingDelete || e.Status == "stopped":
			r.Runtime = "stopped"
		case e.Status == "running" || e.Status == "degraded":
			r.Runtime = e.Status
		}
	}
	r.DraftChanged = published == nil || !reflect.DeepEqual(svc, *published)
	switch {
	case svc.PendingDelete:
		r.Configuration = "pending_delete"
	case r.DraftChanged:
		r.Configuration = "draft"
	case e.SyncState == "failed":
		r.Configuration = "failed"
	case e.SyncState == "syncing" || e.DesiredRevision > e.ObservedRevision:
		r.Configuration = "pending"
	case e.PublishedDraft != nil:
		r.Configuration = "synced"
	default:
		r.Configuration = "unpublished"
	}
	r.RelayEligible = e.Name != "realm" && e.Status == "running" && e.RunIntent == "running" && e.SyncError == "" &&
		e.PublishedRevision > 0 && e.ObservedRevision >= e.PublishedRevision && published != nil &&
		published.Enabled && !published.PendingDelete && published.PublicHost != "" && published.PublicPort > 0
	return r
}

func (r ServiceListItem) MatchesSearch(keyword string) bool {
	if keyword == "" {
		return true
	}
	endpoint := net.JoinHostPort(r.Service.PublicHost, strconv.Itoa(r.Service.PublicPort))
	return strings.Contains(strings.ToLower(strings.Join([]string{r.Service.ID, r.Service.Name, r.Node.Name, endpoint, r.Protocol, r.PresetName}, " ")), keyword)
}
