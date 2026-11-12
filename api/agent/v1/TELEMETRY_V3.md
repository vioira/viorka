# Telemetry v3 contract

Current contract revision: 2026-11-03. Schema and generated models are synchronized between Panel and Agent. Telemetry v3 is the only implemented monitoring protocol and is enabled by default; explicit startup disable does not restore retired monitoring.

## Negotiation and compatibility

Envelope remains 1.0. The Agent advertises `node.telemetry.v3`; the Panel sends `node.telemetry.ready` after `system.hello_ack`. Ready binds the generation and settings. A correlated applied `node.settings.v3_result` activates shared POST/WSS admission. Reconnection negotiates a new session generation while retaining the Agent run. No ready within ten seconds causes a connection error and retry, never legacy fallback. Retired metrics/settings definitions and hello fields are removed. Old monitoring requires upgrading both peers.

| Message | Payload | Direction |
| --- | --- | --- |
| node.telemetry.ready | TelemetryReady | Panel to Agent |
| node.settings.v3 | TelemetrySettings | Panel to Agent |
| node.settings.v3_result | TelemetrySettingsResult | Agent to Panel |
| node.metrics.v3 | TelemetryBatch | Agent to Panel |
| node.metrics.receipt | TelemetryReceipt | Panel to Agent |
| node.metrics.demand | TelemetryDemand | Panel to Agent |
| node.metrics.demand_result | TelemetryDemandResult | Agent to Panel |

Runtime endpoint fixed by this contract: POST `/api/v1/agents/metrics`,
JSON TelemetryBatch body and TelemetryReceipt response. The route, generated OpenAPI and production assembly share the same ingress. Bearer session
authentication, origin/TLS validation and identity revocation are shared with WSS.
No Cookie or URL credentials; management WSS need not currently be online after
capability negotiation. No independent challenge on every POST.

## Sampling and validation

C is an integer 1–60 (default 30), R 30–180 (default 60), W 1–5 (default 2).
C is independent of R, including C>R. HTTP uses C for fast and R for full/POST;
realtime uses W for fast/send, with full still on R. IP refresh is 600 seconds.
Settings persist in `node-telemetry-settings.json`; retired settings files are no longer read or written.

Every group has sequence and sampled_at. A run_id is a fresh UUID v4 per Agent
process. `(authenticated node, run_id, group, sequence)` is the deduplication key;
batch_id identifies only the submission. Sequence increases strictly within each
batch group; repeated or lower watermarks across batches count as duplicates.
Neither cached observations nor channel changes get a new sequence/timestamp.
The authenticated session owns the active run; superseded runs cannot register
again as new observations after their checkpoint expires.

All structure and context are validated before state changes. Unknown fields,
null numeric values, overflow, fractions in integer fields, wrong node, invalid
identity, unordered groups or invalid times reject the entire batch. Missing
optional measurements mean unknown, never zero. Schema checks are separate from
`TelemetryBatch.ValidateIdentity`, which checks only contextual admission.
The latter is not a substitute for full structural validation at P2 ingress.

Fast/full timestamps lie in `[received_at-(R+315s), received_at+300s]`; IP in
`[received_at-915s, received_at+300s]`. Cached IP keeps its own time; stale data
is not a new history observation. Traffic uses the configured monthly billing cycle and IANA timezone. The wire field
`month_start` now denotes the actual period start; `period_end` reports its next boundary. CPU and util are percentages;
bytes/rates are bytes and bytes/s; IOPS is operations/s; await is milliseconds.
Disk interval averages belong only to full.sampled_at's 30-second bucket.
TCP/UDP remain sockstat inuse.

### Disk I/O summary (development contract revision 2026-11-03)

`full.disk_io` is one optional node-level object, not a device array. The Agent
retains per-device baselines locally but sends no device identities or cumulative
disk byte counters. Old array-shaped payloads are rejected; deploy matching Panel
and Agent builds together. No historical conversion or database upgrade is supplied.

Linux selects whole leaf block devices using `/sys/class/block`: exclude partitions,
devices with slaves (dm/md stacking), loop, ram, zram and optical sr devices. Virtual
VPS disks such as vda/vdb remain eligible, including idle disks. Missing topology or
malformed records are excluded and mark the remaining summary partial. No eligible
devices means disk_io_unavailable and an omitted summary. No valid interval yet
means an unknown summary with no numeric measurements.

For each full sample, valid read/write B/s and IOPS are summed independently.
Read/write/combined await use their corresponding completed-operation weights
(equivalent IOPS weights within the shared interval); zero operations have no await.
Utilization is the maximum device busy percentage, not total storage capacity usage.
Invalid fields are omitted, healthy idle rates remain zero, and a partial summary
is never represented as complete. The Panel takes temporal peaks only after this
node aggregation. History stores only six nullable peaks; counts, group timestamps
and quality flags remain live/aggregation concerns and are not persisted.
All disk history lives in metrics_history / metrics_history_old. The UI exposes only
one switchable summary chart, with gaps for unknown fields and partial-data labels.

Counters/revisions/sequences use integers in [0, 2^63-1], with positive identity
sequences. Go uint64 and JSON number parsing retain exact values. Web-facing DTOs
must render large integers as decimal strings rather than convert to JS Number.
The v3 transport is Agent/Panel, not directly consumed by browser clients.

## Bounds and acceptance

POST and pending window: 1 MiB encoded bytes. WSS: 64 KiB per entire envelope,
including metadata. At most 300 fast, 8 full, 2 IP observations per batch; at least
one group must be nonempty. At most 64 interfaces per observation. Disk IO and
capacity are node aggregates; filesystem details are not accepted. JSON nesting remains bounded at 16. Frames must be split by
actual encoded byte size, preserving observation IDs; no oversized observation
is partially admitted. Pending, in-flight, encoding and cached snapshots have
separate bounded ownership, to be verified in P4. A byte limit is not a promise
that a maximum-size device list always fits one WSS frame.

The existing 120 messages/minute per direction is shared by telemetry and control.
P4 reserves 30 messages/minute for control, leaving at most 90 telemetry messages;
metrics must defer/drop with diagnostics when the budget cannot fit split frames.
Task acknowledgements/results keep their existing reliable path.

Accepted receipt has no error_code and accepted_count + duplicate_count equals
the total group observations (not just fast). Rejected receipt has both counts
zero and a stable error_code. ACK means validated and accepted into bounded
memory, not SQLite durability. After any attempted send the taken window is
released, including failure. No offline sample journal or failed-window replay.

## Demand and errors

An enabled demand has exactly 90 seconds TTL; disabled has zero. Renewal every
30 seconds and last-subscriber grace 15 seconds are Panel responsibilities.
Lease duration uses monotonic time from acceptance. Revisions are scoped to
session_generation. Lower revisions and stale generations cannot change state.
An identical revision is idempotent: repeating it does not extend a lease;
renewal requires an increased revision. Same revision/different payload is a
conflict. Restart never restores a lease. A result is applied only after the
bounded in-flight POST transition completes; realtime then pauses new POST.

| Code/class | Action |
| --- | --- |
| invalid_batch | Clear attempted window; transport protocol cooldown 120s |
| overloaded / authenticated 5xx | Shared rejection ladder |
| rate_limited / 429 | Honor Retry-After and R minimum attempt interval |
| session_expired | Serialized session refresh, 120s cooldown |
| session_invalid / identity_revoked / node_disabled | Block identity; no channel bypass |
| unsupported_protocol / missing POST route | Stop unsupported delivery; require a compatible Panel, never legacy fallback |
| stale_session / stale_demand / lease_expired | Reject control transition; never roll back current generation |
| TLS CA/hostname error | Stop origin requests; never bypass TLS |
| DNS/TCP/timeout | Drop window; next POST no earlier than R from attempt start |

Refusal counts 1–2 use R, 3/4/5/6/7+ pause 2/3/5/7/10 minutes. Both channels
share count and one half-open probe. The next attempt is the latest of R,
protocol cooldown, Retry-After and the refusal deadline. Heartbeat success does
not reset metric rejection counts. A valid accepted metric receipt does.

## Verification and remaining gates

`check_protocol.py` validates the current protocol fixtures. `test_telemetry_contract.py`
covers schema boundaries and `go test ./protocol/v1` covers contextual checks,
lossless counters and capability isolation. These tests do not prove runtime
negotiation, TLS dual-transport behavior, persistence or UI integration. Those
remain P1–P6 work. No release/tag or compatibility claim for deployed binaries
is made by adding these contract definitions.

## Runtime semantic admission

Both peers validate the entire batch before using any observation. Schema-valid
payloads can still be rejected as `invalid_batch`: failure markers must agree
with absent values; RAM/Swap and load/socket tuples must be complete when known;
used plus available capacity cannot exceed total. Available capacity may exclude
reserved blocks. All three capacity counters must be present together or absent
with disk_unavailable. Aggregate counters must fit signed 64-bit storage.
OS text excludes controls.

The Agent probes and deduplicates local filesystems only to calculate disk_total,
disk_used and disk_available; mount points, formats and per-filesystem capacities
are neither reported nor stored by the Panel. Local probes remain bounded at 32
unique filesystems. This development contract removes the filesystems field
without backward compatibility; Panel and Agent must update together. No old
database conversion is provided.

Rate-bearing samples require a positive measured interval. Baseline, reset,
identity-changed and unknown observations carry no rates. Partial observations
may omit individual rates; disk await requires completed operations for its
corresponding direction. Monthly traffic uses the sample's UTC month start and
matching interface-filter revision; unknown traffic carries no counters. Public
addresses must be globally usable addresses of the stated family and unavailable
markers must match missing addresses. These checks are implemented by
`DecodeTelemetryBatch` after strict structural and contextual validation. They
do not grant session, capability, run or lease authorization.

P2 shared ingress implementation uses at most eight concurrent decoders, at most
1024 negotiated nodes, and a per-node shared HTTP/WSS token bucket of 16 attempts
per second (burst 32) and 1 MiB per second (burst 2 MiB). Invalid attempts consume
budget too. Rate rejection maps to `rate_limited`; adapters must emit HTTP 429
with Retry-After. These are admission ceilings, not requested sampling rates.
The first fully validated batch binds the session's run; reconnecting with the
same credential preserves this run and budget. A new credential requires renewed
negotiation. Transport adapters still must enforce the WSS *envelope* size and
re-authenticate credentials before calling ingress.

Known expired sessions now remain stored until the same node replaces its
session or deletes/revokes its identity. This preserves safe expiration
classification while other nodes authenticate; session creation still replaces
all sessions belonging to that node. Unknown/deleted tokens never qualify for
expiry refresh. Revoked/disabled status takes precedence over expiration and all
classifications remain unauthorized to existing callers.

The POST adapter requires exactly one Bearer Authorization value, rejects Origin,
Cookie and query parameters, and accepts only uncompressed `application/json`
without media-type parameters. It limits concurrent body reads to eight and
reauthenticates after the bounded body read. Successful receipts return HTTP 200;
known batch rejection receipts use 400/409/429/503. Rejections before a safe batch
ID is decoded use the ordinary API error object instead. 429 and overload 503
include `Retry-After: 1`. Session expiration returns 401 `session_expired`;
missing/deleted sessions return 401 `session_invalid`. Admission never changes
management online status. TLS integration tests exercise the POST adapter with
an explicitly activated negotiation; this does not prove the pending real WSS
ready exchange or Agent dual-channel scheduler.

The Gateway now implements the ready/settings-result exchange behind an explicit
startup-only ConfigureTelemetry gate. Ready follows hello_ack; no fields
are added to the hello message. A correlated applied result activates shared
ingress. Pending settings time out after 30 seconds. Settings updates and metric
receipts use the existing single writer; metric receipt correlation refers to
the upload envelope message ID. V3 settings use independent SQLite storage and
revision space. Revoke/reset/delete cleanup fences delayed settings activation.
Production enables v3 by default. Full Linux/NAT long-duration acceptance remains a separate requirement.

Web management can GET/PUT `/api/v1/nodes/{id}/telemetry-settings` and GET its
`/status` subresource. GET requires viewer; PUT requires admin and the existing
Origin/CSRF protection. Requests reject query parameters and follow strict v3
settings Schema validation, including duplicate/unknown keys and missing/null
fields. PUT checks the expected revision and returns the next desired revision;
this is not proof of Agent application. Status remains pending until a matching
result arrives. These settings can be prepared before upgrading an Agent, and
saving them does not notify or disconnect management-only connections.

## 节点日志等级（开发协议更新）

`TelemetrySettings.log_level` 可选值为 `debug/info/warn/error`，省略默认 `warn`。
随现有 ready/settings 消息及 revision 下发，Agent 耐久写入成功后即时切换并回执，重启恢复。
Panel 节点设置提供等级选择，与监控周期共用保存、审计、冲突检查和确认状态。
本次按测试开发环境直接更新 Schema 和 0010 表定义，不提供旧节点兼容或数据库迁移；
使用本次完整 Schema 的新建测试数据库，既有数据库不会自动增加该列。需同时更新 Panel 和 Agent。

## Traffic configuration and calibration (development contract)

`node.traffic.v1` gates remote traffic configuration and `traffic.calibrate` tasks.
`TelemetrySettings.traffic` contains `interfaces` (comma-separated exact names; empty
uses system defaults), `reset_day` (1–31), `reset_hour` (0–23), `reset_minute` (0–59),
`timezone` (IANA), `billing_mode` (`both` default, `outbound`, `inbound`) and
`quota_bytes` (decimal string, zero means unset). Missing configuration defaults to
UTC day 1 at 00:00, both directions and no quota. Explicit names override the
default selection; missing interfaces reject settings instead of selecting all.

Short months clamp the day to the last calendar day. Schedule changes preserve
the current period and become effective at its existing end; the transition
period starts there and ends at the next configured boundary. Network selection
changes rebaseline counters without clearing accumulated period usage. On an
unobserved cycle boundary, the spanning delta is excluded and marked
`boundary_estimated`; there is no fabricated allocation to the new period.

`POST /api/v1/nodes/{id}/traffic-calibrations` requires admin and CSRF, persists a
node-scoped idempotency key plus `TrafficCalibration`, and returns 202 with a task.
The task carries period_start and exact decimal RX/TX targets. Agent journals
intent before mutation and persists targets plus an idempotency receipt with its
ledger; retries only finish durability, never reset new increments. Period
mismatch/unknown state cannot succeed. At most 64 distinct calibrations per
period are retained. Result correlation includes node, task, attempt and exact
target; the terminal receipt also includes `traffic_before` with the pre-calibration
RX/TX totals for audit. ACK is not success. Quotas only affect display, never network service.

Development-only change: use matching Panel/Agent builds and a fresh development
Panel database. There is no old-history conversion or production migration.
History REST now returns `{avg}` and `{max}` objects without sample counts and
uses `traffic_period_start`. It retains only bucket-level `last_sample_at`.

## TCP 线路质量扩展（2026-11-12）

Envelope 与 Telemetry v3 保持不变。Agent 额外声明 `node.tcp_probe.v1`，Panel 只对声明该能力的 Agent 在 `node.telemetry.ready` 中发送可选 `tcp_probe: true`。缺省为不支持；旧 Agent 不收到新字段，新 Agent 对未确认的 Panel 不探测、不发送扩展。重连时重新协商，发送端剥离缓存中未协商的扩展；HTTP/WSS 共用的接收绑定拒绝未协商探测数据。

`TelemetryFull.tcp_probes` 为可选数组，最多 3 项。目标支持本地 bootstrap 或已协商的面板设置。复用 full 调度、序号、去重、流控和实时快照，不新增连接或历史表。结果包含 `target`、原探测时间 `sampled_at`、窗口秒数、TCP 尝试数 `samples`、失败数 `failures`、可选 `failure_percent` 和成功样本 `median_ms`。单窗口最多 120 次尝试，窗口为 60–3600 秒。延迟不包含 DNS；DNS 失败和地址拦截通过 `last_error` 单独报告，不进入 TCP 失败率分母。取消不产生失败样本，全失败无延迟，无尝试无失败率。失败率不是 ICMP 丢包率。延迟与失败率共用按时间过期的窗口，前端同时检查 full 新鲜度和目标窗口时效。

### 全局与节点目标设置（2026-11-12）

支持 `node.tcp_probe.settings.v1` 的 Agent 接受 `TelemetrySettings.tcp_probe`（`targets` 与 `use_global`）。Panel 解析全局继承后下发实际目标；`use_global` 只表达配置来源。全局默认空列表，节点默认继承；独立空列表表示本节点关闭。全局目标变化在同一事务中仅递增继承节点的监控版本、清除旧回执并发布设置变更。恢复继承使用保存时的最新全局目标，旧版本写入返回冲突。

节点设置与全局设置均仅允许管理员写入，最多 3 个公网 `host:port`。两端共用目标校验，Agent 在 DNS 解析后继续拒绝内网及特殊地址。目标变化经现有持久化、版本与应用回执生效，无需重启；保持本地时间预算（无本地参数时为周期 60 秒、超时 1000 毫秒、窗口 600 秒）。只改变其它监控设置不会清空 TCP 窗口。

旧 Agent 不收到新字段；若存在非空面板目标，Panel 将配置状态记为失败而保留原监控链路，升级 Agent 后重新协商即可应用。旧 Panel 未下发字段时，新 Agent 继续使用本地 bootstrap 目标。新 Panel 显式下发空继承列表时关闭本地目标。新建节点自动继承全局设置。
