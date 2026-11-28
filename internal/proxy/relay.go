package proxy

import "errors"

var (
	ErrRelayApplied  = errors.New("relay draft already applied")
	ErrRelayMapping  = errors.New("conflicting public TCP mapping")
	ErrRelayLanding  = errors.New("landing connection changed or unavailable")
	ErrRelayRevision = errors.New("realm instance or draft changed")
	ErrRelayRule     = errors.New("edit managed relay through its route")
)

type Endpoint struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

type RelayEdit struct {
	Name             string   `json:"name"`
	EngineID         string   `json:"engine_id"`
	LandingEngineID  string   `json:"landing_engine_id"`
	LandingServiceID string   `json:"landing_service_id"`
	Version          int64    `json:"version"`
	LandingRevision  int64    `json:"landing_revision"`
	Public           Endpoint `json:"public"`
	Listen           Endpoint `json:"listen"`
}
type RelayPath struct {
	RelayEdit
	Dial          Endpoint `json:"dial"`
	LandingListen Endpoint `json:"landing_listen"`
	LandingName   string   `json:"landing_name"`
}

type RelayPublicProbe struct {
	Address  string   `json:"address"`
	ID       string   `json:"id"`
	Revision int64    `json:"revision"`
	Endpoint Endpoint `json:"endpoint"`
	State    string   `json:"state" enum:"queued,checking,passed,failed,unavailable"`
	Source   string   `json:"source"`
	Detail   string   `json:"detail"`
	At       string   `json:"at"`
}

type RelayRetest struct {
	Revision int64  `json:"revision"`
	CheckID  string `json:"check_id"`
}

type RelayProbeSummary struct {
	TaskID    string `json:"task_id"`
	State     string `json:"state"`
	At        string `json:"at"`
	Listen    string `json:"listen"`
	Dial      string `json:"dial"`
	ErrorCode string `json:"error_code"`
}

// RelayPublishBase binds a review to the shared Realm instance and its working copy.
type RelayPublishBase struct {
	Revision     int64 `json:"revision"`
	DraftVersion int64 `json:"draft_version"`
	StartsRealm  bool  `json:"starts_realm"`
}

type RelayRoute struct {
	PublicProbe     *RelayPublicProbe  `json:"public_probe,omitempty"`
	PublishBase     *RelayPublishBase  `json:"publish_base,omitempty"`
	ServingRevision int64              `json:"serving_revision"`
	ServingPath     *RelayPath         `json:"serving_path,omitempty"`
	VerifiedAt      string             `json:"verified_at"`
	PublicStale     bool               `json:"public_stale"`
	Online          bool               `json:"online"`
	AppliedRunning  bool               `json:"applied_running"`
	CleanupOnly     bool               `json:"cleanup_only"`
	Probe           *RelayProbeSummary `json:"probe,omitempty"`
	ProbeCapable    bool               `json:"probe_capable"`

	ID               string     `json:"id"`
	EntryNode        string     `json:"entry_node"`
	EntryName        string     `json:"entry_name"`
	Draft            RelayPath  `json:"draft"`
	Published        *RelayPath `json:"published,omitempty"`
	TargetRevision   int64      `json:"target_revision"`
	ObservedRevision int64      `json:"observed_revision"`
	ObservedAt       string     `json:"observed_at"`
	StoppedAt        string     `json:"stopped_at"`
	RemovedAt        string     `json:"removed_at"`
	TaskID           string     `json:"task_id"`
	TaskState        string     `json:"task_state"`
	TaskAt           string     `json:"task_at"`
	ErrorCode        string     `json:"error_code"`
	Reason           string     `json:"reason"`
	CanManage        bool       `json:"can_manage"`
	Affected         []string   `json:"affected"`
}

type RelayAction struct {
	Version    int64  `json:"version"`
	RequestKey string `json:"request_key"`
}
type RelayPublishRequest struct {
	RelayAction
	Review *RelayPublishBase `json:"review"`
}

type RelayEntry struct {
	Domain     string `json:"domain,omitempty" maxLength:"253"`
	ID         string `json:"id"`
	NodeID     string `json:"node_id"`
	Name       string `json:"name"`
	PublicHost string `json:"public_host"`
}

// CanTestPublic requires an applied, still-matching target with a usable landing.
func (r RelayRoute) CanTestPublic() bool {
	return r.AppliedRunning && (r.Reason == "awaiting_public" || r.Reason == "available" || r.Reason == "public_mapping_changed" || r.Reason == "public_failed" || r.Reason == "probe_unavailable")
}
