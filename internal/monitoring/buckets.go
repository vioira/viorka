package monitoring

// Mean stores sufficient statistics. A nil sum with count zero means unknown.
type Mean struct {
	Sum   *float64 `json:"sum"`
	Count uint64   `json:"count"`
}

// Peak is a sampled maximum, not a continuous-time peak.
type Peak struct {
	Max   *float64 `json:"max"`
	Count uint64   `json:"count"`
}

// Bucket is the authoritative, typed 30-second history state. Times are UTC
// Unix milliseconds except Start and MonthStart (Unix seconds).
type Bucket struct {
	Sealed                bool       `json:"-"` // Restored buckets are immutable; original sample weights were intentionally not stored.
	Node                  string     `json:"node_id"`
	Start                 int64      `json:"bucket_start"`
	LastSample            int64      `json:"last_sample_at"`
	FastCount             uint64     `json:"fast_sample_count"`
	FullCount             uint64     `json:"full_sample_count"`
	Semantics             string     `json:"metric_semantics"`
	Quality               uint64     `json:"quality_flags"`
	RAMTotal              *uint64    `json:"ram_total"`
	SwapTotal             *uint64    `json:"swap_total"`
	MemoryAt              *uint64    `json:"memory_sampled_at"`
	NetInTotal            *uint64    `json:"net_in_total"`
	NetOutTotal           *uint64    `json:"net_out_total"`
	NetworkAt             *uint64    `json:"net_sampled_at"`
	MonthIn               *uint64    `json:"net_month_in"`
	MonthOut              *uint64    `json:"net_month_out"`
	MonthStart            *uint64    `json:"traffic_month_start"`
	TrafficAt             *uint64    `json:"traffic_sampled_at"`
	TrafficQuality        *uint64    `json:"traffic_quality"`
	DiskTotal             *uint64    `json:"disk_total"`
	DiskUsed              *uint64    `json:"disk_used"`
	DiskAvailable         *uint64    `json:"disk_available"`
	DiskAt                *uint64    `json:"disk_sampled_at"`
	LoadAt                *uint64    `json:"load_sampled_at"`
	UptimeAt              *uint64    `json:"uptime_sampled_at"`
	Load1                 *float64   `json:"load_1"`
	Load5                 *float64   `json:"load_5"`
	Load15                *float64   `json:"load_15"`
	Uptime                *float64   `json:"uptime_seconds"`
	FilterRevision        string     `json:"filter_revision"`
	TrafficFilterRevision string     `json:"traffic_filter_revision"`
	UpdatedAt             int64      `json:"updated_at"`
	CPU                   Mean       `json:"cpu"`
	RAMUsed               Mean       `json:"ram_used"`
	SwapUsed              Mean       `json:"swap_used"`
	NetInSpeed            Peak       `json:"net_in_speed"`
	NetOutSpeed           Peak       `json:"net_out_speed"`
	TCPCount              Peak       `json:"tcp_count"`
	UDPCount              Peak       `json:"udp_count"`
	ProcessCount          Peak       `json:"process_count"`
	DiskIO                DiskBucket `json:"disk_io"`
}

type DiskBucket struct {
	Quality    uint64 `json:"quality_flags"`
	LastSample int64  `json:"sampled_at"`
	ReadSpeed  Peak   `json:"read_speed"`
	WriteSpeed Peak   `json:"write_speed"`
	ReadIOPS   Peak   `json:"read_iops"`
	WriteIOPS  Peak   `json:"write_iops"`
	ReadAwait  Peak   `json:"read_await_ms"`
	WriteAwait Peak   `json:"write_await_ms"`
	Await      Peak   `json:"await_ms"`
	Util       Peak   `json:"util_percent"`
}
type Checkpoint struct {
	RunID, Group string
	Sequence     uint64
	SampledAt    int64
}
type SystemSnapshot struct {
	OSID, OSName, OSVersion string
	SampledAt               int64
	Unavailable             bool
}
type AddressSnapshot struct {
	Family      int
	Address     string
	SampledAt   int64
	Unavailable bool
}

// NodeHistory is the indivisible commit unit. Checkpoints must cover precisely
// these absolute bucket/asset snapshots, never a subset of the node's dirty rows.
type NodeHistory struct {
	Node        string
	TCPProbes   []TCPHistoryPoint
	Buckets     []Bucket
	Checkpoints []Checkpoint
	System      *SystemSnapshot
	Addresses   []AddressSnapshot
}
