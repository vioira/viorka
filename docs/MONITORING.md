# 节点主机监控

当前只支持 `node.telemetry.v3`，旧版 Agent 监控设置、REST 设置接口、v1/v2 指标上报和自动回退路径已移除。外层 Envelope 仍为 1.0；监控能力必须单独协商。Panel 与 Agent 需要配套升级，不能再依赖旧版监控兼容。

默认启用 v3。Panel 的 `VIORKA_TELEMETRY_V3=false` 或 Agent 的 `telemetry_v3:false` 可明确停用新版监控，但不会恢复旧协议。管理连接、身份、只读任务和代理进程生命周期保持独立。

- 常规快速采集 C 为 1–60 秒，默认 30；HTTP 上报及完整采集 R 为 30–180 秒，默认 60；实时采集/上报 W 为 1–5 秒，默认 2。C 与 R 独立。
- 无浏览器订阅时通过认证 HTTP POST 上报；有效实时需求租约使用 WSS。每组保留独立采样时间、水位与错误状态，未知值不补零。
- fast 包含 CPU、内存/Swap、运行时长、网络与套接字；full 包含负载、进程数、文件系统和设备 IO；公网 IP 每 600 秒刷新。资产探测独立运行。
- 设置使用 `node.settings.v3` / `node.settings.v3_result`，保存于固定 `node-telemetry-settings.json`，先验证和原子持久化再确认。旧 `node-settings.json` 不再读取或写入。`metrics_seconds` 已删除，旧 bootstrap 中应移除此字段。
- Panel 设置入口仅为 `/api/v1/nodes/{id}/telemetry-settings` 及 `/status`；保存 Desired 不代表 Agent 已应用。旧 `/settings` 接口返回 404。
- 服务端实时窗口最多 600 点、10 分钟；前端按最近 10 分钟保留原始采样，容量上限 1200 条（覆盖 fast/full 各每秒一条）。实时页首次进入以服务端 30 秒历史桶铺底，之后仅追加进入后的原始采样；同采集组同桶优先展示原始采样，重连重新读取历史补充缺口，暂停时冻结历史和实时数据。历史聚合值直接展示，不在实时页二次聚合。历史按 UTC 30 秒桶聚合，查询保留最近 168 小时。管理连接离线不使仍新鲜的 HTTP 数据自动过期。
- 文件系统使用率按 used/(used+available) 计算，排除保留空间；磁盘 IO 由 Agent 筛选整盘底层设备、去除分层重复后汇总；实时和历史磁盘 IO 图表固定显示汇总读写速度，不提供指标切换，未知留缺口，部分数据有标记。大整数以十进制字符串传给浏览器。

Agent 仅主动出站；断线、停用监控或停止 Agent 不停止代理服务。Linux 采集不依赖 root，权限不足报告未知；非 Linux 报告 unsupported_platform。macOS 自动化检查不能替代 Debian/Ubuntu/Alpine、Linux arm64 与低配 NAT VPS 的实机长稳验收。

### 当前类型化 30 秒历史

Panel 历史已切换到类型化新周表：UTC 30 秒基础桶，每 5 秒检查刷盘，与采集和上报周期独立。CPU、RAM used、Swap used 使用各自 sum/count；速度、socket/进程和设备 I/O 使用 MAX；容量、累计、负载保留最新有效观测及真实时间。慢组不会复制进每个快组桶，缺失值为 NULL。

不读取旧 60 秒记录、不转换旧历史。使用全新隔离测试库；旧库会明确拒绝，现有库不自动清空。新表自己的重启恢复和去重检查点仍受事务保护。旧 Agent 指标不再接收；既有历史数据不在此次代码清理中主动删除。

历史 API 已改为类型化字段，提供 10m/1h/6h/24h/2d/7d 范围（10m 和 1h 均为 30 秒分辨率）与 30/180/720/1440/3600 秒分辨率，大字节计数输出十进制字符串。只合并起点落在查询范围内的完整基础桶，不插值边界。前端通过 typed DTO 转换保留均值、采样峰值与最新值语义，未知值保持缺口，历史 IO 按设备展示。该路径已通过前端测试和构建；仍需完整联合验收后才能发布。

v3 使用独立的最多600点、10分钟窗口，并支持 POST/WSS 自动模式、订阅租约和采集拆分。默认启用，仍须双方完成能力协商。参见 [Telemetry v3 契约](../api/agent/v1/TELEMETRY_V3.md)。

## 新版监控 Web 设置与观测

节点设置页默认使用独立 `/nodes/{id}/telemetry-settings` 与 `/status`，不复用旧设置的 revision 或存储。管理员可设置常规采集 1–60 秒、HTTP 上报 30–180 秒、WSS 实时上报 1–5 秒；采集间隔可以大于 HTTP 上报间隔。未协商 v3 的节点仍可保存期望配置等待后续协商，页面仅保留新版设置。

保存成功只代表 Desired 已落库。界面分别显示期望版本、匹配该版本的 Agent 确认、最新快照中的已应用配置。旧版本回执不能让新版本显示已生效。并发修改返回冲突并保留输入；重新读取会替换输入。只读角色不可提交，服务端仍执行管理员鉴权与 CSRF 校验。

指标页消费 v3 fast/full/public_ip 快照与有界 SSE 点窗口，管理在线状态与采样新鲜度独立。每组按自己的采样和接收时间过期，整体 HTTP 接收不能使旧组变新。月流量保留精确十进制计数及完整性标记，设备 IO 不做跨层主机合计。前端已有本地测试、fixture以及真实Ubuntu Agent浏览器联调证据；完整真实平台与跨仓失败矩阵仍待验收。

### 受控启用与跨仓进程测试

Panel 的 `VIORKA_TELEMETRY_V3` 默认启用，仅接受 `true`/`false`（空值为启用）。启用时，启动装配把同一 TelemetryIngress 同时接到 Gateway 和 POST；Agent 从本地配置加载时也默认启用 `telemetry_v3`，显式 `false` 可关闭。这是启动配置，需要重启对应进程，不是浏览器实时需求开关。关闭时停止新版监控能力，不恢复旧协议，不删除历史或节点服务。

跨仓真实进程测试先在 Agent 仓库构建 `go build -o /tmp/viorka-monitoring-agent ./cmd/viorka-agent`，再在 Panel 仓库运行 `VIORKA_TEST_AGENT_BINARY=/tmp/viorka-monitoring-agent go test ./internal/httpapi -run '^TestTelemetryAgentProcess' -count=1 -v`。测试使用临时SQLite、TLS测试证书与显式CA、stdin注册Token和真实Agent子进程，覆盖无viewer的HTTP、租约实时WSS、最后viewer宽限后恢复HTTP及有界退出。ManagementOutage场景在测试HTTP中间件中取消管理请求并拒绝WSS重连，保留POST，检查离线时新HTTP观测、恢复原订阅、run身份连续和重连后只读任务。切回HTTP后必须再观察到更高序号，不能将宽限期的WSS样本当作恢复证据。未指定二进制时该测试明确skip；普通go test通过不能替代该测试证据。LostPOSTResponse场景在真实鉴权入口接收首批后中断HTTP响应，检查下一POST遵守R、只带更新的单个fast样本且保持run，实际 SQLite 桶成员与两批已接收点的 UTC 分桶一致；随后继续租约切换与只读任务。Agent采用真实平台采集器，公网IP探测结果不作为通过条件。此测试不代表Linux/NAT或24/72小时验收。

双进程race检查需同时给Agent构建命令和Panel测试命令添加`-race`；仅给go test添加该参数不会检测外部Agent进程。短测每个场景有8分钟总deadline，长稳另加配置的观测时长，超时会停止测试子进程。测试仅访问临时注册节点，不改变用户代理或生产配置。

### 持续单节点资源观测

`TestTelemetryAgentSoak` 是显式启用的 Linux procfs 测试。设置 `VIORKA_TEST_AGENT_BINARY`（绝对路径）、`VIORKA_TEST_SOAK_DURATION`（1m–72h）和 `VIORKA_TEST_SOAK_OUTPUT`（不存在的绝对文件路径），选择 `-run '^TestTelemetryAgentSoak$'`，并使 Go `-timeout` 大于观测时长加8分钟。默认测试跳过此项。先以1m验证夹具，不能把短测计作24小时验收。

同一真实Agent与Panel测试进程连续运行，使用默认C30/R60/W2，每5分钟切换HTTP与viewer实时需求。Recorder持续按5秒运行刷盘/周维护；每10秒将时间、序号、模式、freshness、两进程RSS/CPU原始tick/FD/socket FD/磁盘读写字节、Panel goroutine/heap、DB/WAL大小写入0600 JSONL并同步。数据文件最多16MiB/26000行，Agent进程日志最多8MiB。超过3分钟无新序号或viewer切换后模式45秒不收敛会使测试失败（续租pending另允许最多15秒观测窗口）。只有观察到成功鉴权签发下一代会话，才允许R+45秒恢复窗口；10秒轮询使窗口起点最多晚10秒，期间再次签发不得延长窗口，初始会话不授予宽限。JSONL记录session_epoch及session_recovery_remaining_seconds。窗口结束后持续pending或degraded仍失败；run变更或采集资源信息失败也会使测试失败。结束检查真实历史并有界退出。

这是一节点/进程内真实Panel服务的连续测试，不能替代50节点并发、完整Panel可执行文件、SSE浏览器延迟或NAT72小时测试。CPU以原始tick记录，不假设USER_HZ；socket FD不是TCP连接数，procfs读写字节不是网络流量；Agent内部goroutine、完整网络字节率及刷盘逐次延迟尚需专门测量。JSONL中的observation_window_complete只表示采样时长达到，最终成功还需测试PASS和子进程退出。

新版容量总览及v3历史使用率按 `ceil(100 × used / (used + available))` 计算，分母为零或缺字段显示未知；使用精确整数避免大字节数先转浮点带来的边界误差。旧根文件系统系列已移除；既有 legacy/mixed 语义桶不绘制容量百分比，避免与新版本地文件系统合计混用。

## v3 运行诊断

Agent 的 `Telemetry status` 每分钟最多一条，记录采集/传输/窗口与账本状态，详见 Agent 仓库 CONFIGURATION。Panel 的后台 Recorder 每分钟最多一条 `Telemetry history status`，默认只输出紧凑摘要：

```text
INFO Telemetry history status status=waiting_for_data nodes=0 dirty_nodes=0
```

`status=waiting_for_data` 表示本次初始化以来尚未接受新观测；`ok` 表示当前没有触发告警条件，不代表节点在线、数据新鲜或所有历史已持久化；`degraded` 对应 WARN。`nodes` 是记录器内存中的节点数，不是注册节点总数。有值时附带最后接收新观测时间、最近刷盘成功时间和非零保守内存记账字节。WARN 时补充初始化时间、刷盘尝试和轮换尝试/成功时间；失败次数、重试时间、错误标记及累计过期未提交桶数仅在非零/为真时输出。所有时间均是该轮工作的时间基准，尚未发生的时间直接省略，不再打印 `0001-01-01`。日志在释放接收锁后输出，不包含节点载荷、数据库查询或原始错误文本。

数据库写入失败保持原有有界退避与dirty状态。新的过期未提交桶、刷盘故障或轮换故障会使汇总日志为 WARN；累计过期桶数始终保留，不能将下一轮INFO解释为已找回丢失数据。汇总替代逐桶日志，避免批量过期引起日志洪泛。入口成功回执不代表已落库，`last_flush_success`也只表示某次有界提交成功，必须同时检查`dirty_nodes`、失败/重试状态及过期计数；它不代表所有节点已经完全同步。`accounted_bytes`是聚合器保守记账，不是进程RSS或完整服务总内存。

按节点的当前模式、订阅引用数量与租约剩余时间已通过鉴权后的实时快照`telemetry_control`暴露；指标组保留原有错误码和时间。没有新增公开调试端口、日志下载接口或远程任意命令。

### HTTP 突发接入预算

指标POST先鉴权，再获取上传槽位，最后才读取请求体。保留8个同时读体/处理槽位；另允许最多56个已鉴权请求等待，最长250毫秒，等待期间不分配指标body缓存。不创建额外goroutine或无限队列。队列满、等待超时仍返回503/overloaded与Retry-After；取消释放等待槽位。请求体仍受1MiB和HTTP读deadline约束，排队后正式接收前再次验证身份，不能绕过吊销。共享HTTP/WSS解码并发与历史内存预算保持原值。

这用于吸收正常小批次在同一时刻到达的短暂突发，不能保证慢客户端/慢存储/大批次永不被拒绝；Agent仍须遵守失败窗口放弃和有界退避。50节点性能实测及失败记录见Agent仓库MONITORING_RESOURCE_REPORT.md，不能据队列容量推断生产吞吐。

### 50 节点短时性能夹具

`TestTelemetryFiftyNodesHTTP` 与 `TestTelemetryFiftyNodesRealtime` 是Linux显式启用测试：分别设置`VIORKA_TEST_LOAD_HTTP=1`或`VIORKA_TEST_LOAD_WSS=1`，并设置`VIORKA_TEST_LOAD_OUTPUT`为不存在的绝对JSONL路径；一次选择一个测试运行，Go timeout至少5分钟。工作目录为`internal/httpapi`以读取协议示例。HTTP固定三轮同步50POST、真实R60；实时固定121轮每秒50帧、full每60秒，处理真实demand/续租ACK与心跳，并拒绝用catch-up掩盖发送延迟。两者都验证最终每节点真实SQLite采样计数与管理在线。

客户端是合成协议负载，采用真实TLS、身份协商、HTTP/WSS和SQLite，不是50个真实Agent采集器。资源JSONL记录Panel和生成器同进程的procfs/RSS/FD、goroutine、DB/WAL、客户端TLS字节/连接创建、入口回执延迟和Flush调用耗时；不含真实浏览器SSE显示延迟。`payload_bytes`在HTTP场景是批次JSON字节，在WSS场景含协议envelope；网络字节另以TLS下层计数。成功必须有最终complete记录且测试PASS；failed_wave和missed_deadline为失败证据。实际结果和限制记录在Agent仓库MONITORING_RESOURCE_REPORT.md。

### 真实浏览器联调夹具

运行 `python3 scripts/monitoring_browser_fixture.py --minutes 60` 构建真实Web、Panel和邻接Agent仓库；仅使用随机回环端口和私有临时数据。`--remote-agent`只输出独立Agent的配置/注册输入，供已授权隔离Linux环境使用。夹具创建一个真实采集节点及60个无指标待注册节点以覆盖50条分页。启动结果提供origin和私有fixture.json路径；凭证仅存私有文件，不应写入报告。自签证书不修改系统信任；浏览器遇到安全拦截须由使用者处理，不自动绕过。

SIGINT/SIGTERM及最长120分钟限制只终止夹具自己的子进程，保留私有日志；外部启动的远端Agent与SSH隧道须单独有界运行。旧首页演示数据不能作为监控验收证据，应从节点列表进入真实节点。soak模式另将最多8MiB的Agent日志保存为`VIORKA_TEST_SOAK_OUTPUT + ".agent.log"`，以0600及排他创建保留失败诊断，不因测试临时目录清理丢失。

连续拒绝联调使用`TestTelemetryAgentProcessRefusalsAndTasks`：临时TLS服务器在指标上传路径注入三次503/Retry-After，每次拒绝期间发送真实只读任务，要求任务成功且指标序号不增长；第三次拒绝后恢复入口，要求等待至少119秒后才收到更高序号并保持run，再执行正常实时切换与关闭。该场景不替代全部七级退避、WSS丢ACK或身份撤销测试。

`TestTelemetryAgentProcessThirtyPointBatch`使用真实Agent的C2/R60配置，检查首POST的30条样本身份及约2秒间隔，将各原始sampled_at归入UTC30秒桶，并与真实 SQLite 的 UTC 桶成员逐项核对。启动不刻意对齐UTC边界，因此可能覆盖2或3个基础桶。随后继续正常WSS切换和有界关闭；macOS运行只能证明真实传输/持久化，Linux资源采集须另行验证。

`TestTelemetryAgentProcessLostWSSReceipt`在测试TLS WebSocket转发器中只丢弃一条真实Gateway已接受指标的成功回执；管理、设置、需求及任务消息继续转发。验证Agent在回执超时后使用HTTP最新单点兜底，保留新样本原身份，距离前一次POST不短于R，并恢复WSS、完成最后viewer宽限退出及进程关闭。入口成功不代表SQLite耐久提交；该测试不声称精确崩溃窗口已覆盖。转发器仅存在于_test.go，不增加生产调试开关。

`storage.TestTelemetryRecorderCrashBoundary`以父子进程验证持久化边界：先提交序号1，子进程接受序号2后分别在未Flush/已Flush成功两个位置通过管道报告边界，父进程立即强制终止；重新打开数据库检查fast数量分别为1/2，且对应已提交序号重投被去重。子进程正常退出清理不会运行。该测试覆盖Recorder与真实SQLite，不含HTTP回执发送或物理断电；未刷盘的已接收样本允许丢失，不能把入口成功承诺为耐久保存。

`TestTelemetryHTTPTimestampAdmissionAndAtomicity`使用真实TLS入口与临时SQLite、合成协议样本，验证R180合法旧fast、未来时间容差、超期fast和IP的整批拒绝，以及IP缓存时间不被接收时间刷新。拒绝后既无fast历史计数，也不建立live run。HTTP场景采用秒级裕量避免调度抖动；-495/+300秒及超出1纳秒的精确边界由双方`TestTelemetryContextAdmission`的固定时钟验证。样本IP仅为协议测试数据，不发起公网探测。

`TestTelemetryAgentProcessScheduledSessionRefresh`仅在测试响应中缩短首个会话告知Agent的有效期到140秒，使用默认C30/R60/W2，使主动刷新错开HTTP边界；服务端签名挑战、凭证签发和替换仍真实执行。检查一次替换会话、HTTP探测遵守R且保留run/最新原样本、原订阅在R+45秒内恢复WSS及后续任务成功。探测允许合法全重复回执，不把已接受的旧缓存再计作新样本。此测试不等同于服务端同时吊销或两个通道同时过期。实际通过记录以Agent仓库进度为准。


`TestTelemetryAgentProcessLostWSSReceipt`还记录真实HTTP和WSS接受的fast原始身份（4096条测试上限），检查重复sequence不改变sampled_at；Agent退出后Flush，逐个 UTC 桶成员与 SQLite 一致。该断言覆盖丢回执、HTTP兜底与恢复期间不重复累计；不将接收回执解释为持久化完成。`TestTelemetryHistoryTwoPartitionsRangeAndGaps`以真实两张周表和固定时间验证168小时精确边界、越界拒绝、缺口保留及小时合并统计。

### 磁盘容量汇总

页面仅保留节点容量概览和趋势，不展示文件系统明细。Agent 本地过滤、去重后上报总量、已用和可用容量，不上报挂载点与文件系统格式。容量不可用时保留未知语义，不使用零值替代。历史主表保存 30 秒桶内最新有效容量，时间统一使用桶级 last_sample_at，无文件系统明细表。本次开发期调整要求 Panel/Agent 配套更新，不迁移旧开发数据。


## 可配置周期流量与精简历史

节点设置支持网卡名称（英文逗号分隔）、每月重置日和时间、IANA 时区、周期额度（GB，1 GB = 1,000,000,000 字节）及计费方式。默认上行加下行，也支持仅上行/出站和仅下行/入站。指标页展示周期起点、下次重置、计费用量、额度使用百分比、剩余或超出量；未知数据不补零。

手动校准输入本周期上行、下行目标累计值，创建管理员任务；页面显示待执行/已生效/未确认成功。采集端持久化后确认，之后继续累加增量。校准不重写历史，周期变化时旧任务不能修改新周期。任务失败或回执不确定时先重新同步实际累计值，再决定是否校准。

历史表只保留 32 列，磁盘 I/O 为六项峰值。CPU/内存按 30 秒桶内平均，再对有值的桶等权聚合，不保留采样次数。组时间、历史质量与过滤版本不再持久化；实时采样质量和去重身份仍保留。Panel 重启后已恢复桶封存，防止丢失原始权重后错误追加均值；详情见 DATABASE.md。开发期直接更新建表 SQL，不执行旧数据迁移。

### 慢采集组历史图显示粒度

文件系统、磁盘 IO、负载与进程数的 1 小时历史图在前端将 30 秒基础桶合并为 UTC 对齐的 3 分钟显示桶，覆盖完整采集组允许的最长 180 秒采集周期，避免把正常的慢采集间隔画成连续断点。IO 和进程数取峰值，容量与负载取最新有效值；图表悬浮提示显示实际桶区间；卡片底部不再显示采样数量、显示时段或汇总说明。整桶没有某指标时仍显示未知并断线，不补零、不延续旧值。CPU、内存、网络等快组及实时图不变，原始 30 秒历史仍保留在接口与数据库中；页面不再提供独立的采样数值列表。

这不是逐次采集成功率视图：当前历史未持久化采集组时间与错误，无法可靠识别桶内每次失败，3 分钟内的短缺口可能被同桶的有效观测覆盖；较长范围沿用 API 原有聚合粒度。

### 节点列表请求与摘要

节点列表 `GET /api/v1/nodes` 每页批量读取已安装引擎的 `name/version`，不再由浏览器逐节点调用引擎接口。`engines` 只对管理员或具有对应节点引擎读取授权的用户返回；有权限但未安装时为 `[]`，无权限时省略。业务 SSE 的 `change(kind=node)` 同样携带当前引擎摘要，安装、卸载及版本变更随节点事件更新。

列表指标订阅 `GET /api/v1/metrics/events?through=<最后节点ID>` 的 `metrics` 帧仍包含 `reset/items/removed_ids`，每个 item 仅包含 `received_at`、`expires_at`、可空的 `cpu` 和 `memory` 百分比。不返回完整 Telemetry、设备数组、历史采样或控制状态。`expires_at` 按实际 fast 采样/接收时间与已应用上报模式计算，浏览器到期显示未知；缺失或采集失败的值为 `null`。`node=<ID>` 详情订阅继续返回完整指标。

首次加载在共享业务 SSE 的 ready 后执行；SSE 关闭时直接读取，建立连接超过 3 秒仍未 ready 时执行一次 REST 读取。重连/溢出 ready 重新同步。并发刷新复用同一读取，读取期间的节点集合变更合并成后续一轮，单节点事件直接补丁更新；添加节点成功且业务流已连接时依赖集合事件更新，不额外刷新。

列表指标首帧立即发送；后续由首次变更启动固定的 5 秒合并窗口，窗口内持续排空事件队列，按节点 ID 去重，到期只读取并发送最新摘要。后续事件不延后截止时间，没有待发送变化时不启动定时器。待发送节点集合不超过当前订阅范围（最多 1024 个）；队列溢出合并为窗口到期时的一次完整同步。详情指标保留 100ms 合并窗口。权限撤销、SSE 关闭和连接取消不等待合并窗口，15 秒心跳照常执行。

纯 Agent 心跳只持久化 `last_seen_at`，不广播节点事件；在线节点的最后在线时间随其它节点事件或手动刷新更新，离线事件携带最新记录。节点上下线、禁用、引擎变化及新增/删除继续通过独立业务流即时通知。摘要的 `received_at`、`expires_at` 统一输出 UTC（`Z`），保留实际接收及过期时间，不因合并发送延长有效期。
