# Agent wire protocol（v1）

`envelope.schema.json` 是权威 Schema；`scripts/generate_protocol.py` 为两个仓库生成带 SHA-256 的模型。Agent 保存同版本 Schema 快照独立校验。示例仅供合约测试，不授予任务执行权限。

管理 WSS 完成 hello 握手后，Agent 主动停机时发送私有 WebSocket Close 码 `4001`（agent stopping）。Panel 在释放该节点的连接名额前将在线节点标为离线并推送节点事件。普通关闭、断网、会话轮换及未收到停机帧均沿用心跳超时。旧版本可忽略关闭码，Envelope 仍为 1.0。

2026-11-03 监控契约修订移除了旧 NodeSettings、NodeMetrics 及扩展、旧握手指标/设置字段和相关样例。Envelope 仍为 1.0，监控能力仅支持 `node.telemetry.v3`。新 Panel 不下发或接收旧监控消息，新 Agent 不声明旧能力或回退旧采集；旧 Agent 需要升级。身份注册、心跳、`node.inventory.v1` 和类型化任务协议保持原语义。

新版协商及完整字段见 [TELEMETRY_V3.md](TELEMETRY_V3.md)，实现行为见 [监控说明](../../../docs/MONITORING.md)。独立产品版本不要求同号，但发布需携带此匹配 Schema；工作区同步不等于已发布制品。

2026-11-05 引擎管理能力升级为 `engine.manage.v2`：`EngineService.short_id` 替换为必填 `short_ids` 数组。VLESS 服务包含 1 至 8 个不重复（忽略大小写）的偶数位十六进制值，每项 2 至 16 位；Realm 使用空数组。sing-box 和 Xray 接收完整列表，单条客户端链接使用第一项。Envelope 仍为 1.0，REST 路径不变；旧引擎能力不协商、不降级，新旧 Panel/Agent 需配套升级。本地同步不代表已发布。

2026-11-05 出口与分流新增 `engine.manage.v3`：sing-box `engine.apply` 可携带 `outbounds` 和 `routing`，引用 ID 必须完整对应，规则有序且有界；HTTP CONNECT 仅限 TCP 规则。旧 v1/v2 能力不执行新引擎任务，需配套升级。Envelope 1.0 与 REST v1 保持不变。示例见 `examples/engine.egress.json`，完整说明见 `docs/OUTBOUNDS.md`（Panel 仓库根目录）。

2026-11-06：EngineOutbound 支持普通 VLESS TCP：type=vless、tls=false（或省略），仅使用服务器、端口和 UUID，禁止 REALITY/TLS 字段和 Flow。tls=true 仍要求完整 REALITY 参数。字段及 engine.manage.v3 不变；旧实现明确拒绝普通 TCP，需配套更新 Agent 校验。本次仅本地实现，未发布或部署。

2026-11-07 引擎诊断能力升级为 `engine.manage.v4`。EngineResult 新增可选 diagnostic：stage 为固定执行阶段，message 最多 512 字符、不得含控制字符，interrupted 表示上次执行异常中断，http_status/exit_code 为可选结构化数值。仅失败结果携带诊断，中断标志仅用于 engine_result_unknown；不传原始日志、配置、凭据或下载 URL。Agent 在阶段副作用前持久化 stage，任务重投时将最后阶段随中断结果补报。没有系统 OOM 证据时不标记“内存不足”。Envelope 保持 1.0；新 Panel/Agent 只协商 v4，引擎管理需配套更新，旧 v3 不混用。已持久化旧任务无 diagnostic 时仍可展示错误码。本地协议同步不等于发布。

2026-11-07 引擎能力升级为 `engine.manage.v5`，Envelope 仍为 1.0。新增诊断阶段 verify_binary/install_dependencies，错误码 engine_dependency_missing/engine_dependency_install_failed/engine_binary_unusable。安装、升级、应用配置和启动引擎默认自动修复白名单依赖，无新增用户确认字段；只读检查只检测和报告。系统包安装仅限 Agent 固定官方仓库、固定包名/版本，保留 APK 签名校验。Panel/Agent 需配套发布，v4 不声明 v5 能力，不派发新引擎任务。

### 注册恢复托管引擎

`POST /api/v1/agents/enroll` 支持可选 `engines: EngineRecovery[]`（最多 3 项，请求体最多 3 MiB）。Agent 在显式新注册时核对本机托管服务、二进制与有效配置，并携带原 `engine_id`、完整 `command` 和真实 `running/stopped` 状态；秘密只经 TLS 传递。Panel 在注册事务中恢复缺失的引擎记录，同节点已有记录不覆盖、其他节点仍持有的 ID 拒绝，令牌重试仍按原 token/key 绑定。原节点换钥不需要上传快照。Panel 在新身份上线后通过现有 `engine.inspect` 的 `recovery_check` 逐项核对之前的托管引擎。该扩展要求配套 Panel；不改变 WSS 任务能力版本。

2026-11-11 引擎能力升级为 `engine.manage.v6`。`engine.inspect` 可携带 `include_config=true`，成功结果返回 `configuration`（实际配置修订号和完整原生文件列表）。Agent 先校验托管归属、活动文件及进程健康，再返回读取结果；失败不返回配置。JSON 凭证字段原样返回，Panel 加密保存，仅通过节点管理授权的专用接口读取，Realm 仅接受托管 TCP 转发格式。配置正文合计不超过 32 KiB，序列化后不超过 48 KiB，保持 64 KiB Envelope 上限。Panel/Agent 必须配套更新，v5 不派发 v6 引擎任务。

当前引擎能力为 `engine.manage.v8`，Envelope 仍为 1.0。恢复数据库后，授权管理者可发起携带 `recovery_check=true` 的 `engine.inspect`，与 `include_config` 互斥。Agent 只读核对本机托管归属和活动配置，已安装时返回受限的 `recovery` 和真实 `recovery_revision`；新安装且没有活动配置的停止状态返回空服务列表，明确未安装时返回 `not_installed` 和修订号。Panel 验证任务、节点、attempt 和资源后加密保存观察结果，普通任务响应与通知不携带配置或凭证。旧能力不执行 v8 引擎任务，Panel/Agent 需配套更新；详见 [订阅恢复](../../../docs/SUBSCRIPTIONS.md)。本地同步不代表发布或实机验证。

## 批量自动注册

新增的 `POST /api/v1/agents/register` 是 HTTPS bootstrap REST 契约，定义和生成 Schema 见 `internal/auth/registration.go`、`api/openapi/openapi.yaml` 与 [PROTOCOL.md](../../../docs/PROTOCOL.md#批量自动注册-rest-契约)。它支持单节点令牌绑定预建节点，以及批量令牌自动创建节点，不改变本目录 Envelope 1.0。Agent 需要支持 `register --token-stdin`，单节点令牌同样使用 `register`，不再提供 `enroll` 命令。

独立能力 `engine.endpoints.v1` 允许 Panel 在认证 WSS 上发送 `engine.endpoints`。每条消息绑定一个引擎 ID、名称和有效配置摘要，最多包含 32 个按服务 ID 登记的域名/IP 和公网端口。空数组清除先前登记。入口发布和引擎确认后推送，连接建立和约每 30 秒重新同步；消息送出与 Agent 落盘是两个阶段。Agent 在注册快照的可选 `endpoint_backup` 字段返还已落盘且仍匹配的记录；引擎任务能力及 Envelope 版本不变。

`engine.manage.v8` 在 sing-box `EngineRouteRule` 新增 `geoip` 和 `geosite`。字段各限 64 个代码，无法与 `match_all=true` 同用。同字段按 OR，不同字段按 AND。旧 Agent 不协商 v8 引擎任务。

已注册节点通过独立能力 `engine.recovery.v1` 执行只读 `engine.recover`。命令使用当前节点 ID 作为 `resource_id`，按固定引擎名核对本机托管记录，修订为 0。结果关联原任务与 attempt，返回原引擎 ID、已应用命令及实际状态，`unconfigured=true` 表示已安装但没有活动配置文件。匹配当前任务的结果帧上限为 128 KiB，其他帧保留 64 KiB 上限。Panel 保存加密快照，Web 预览只返回元数据，管理员另行确认才能恢复记录。注册时的 `engines` 也支持 `unconfigured`，所以应先更新 Panel，再更新 Agent。示例见 [核对任务](examples/engine.recover.json) 和 [核对结果](examples/engine.recover-result.json)。

### 公开地址迁移（panel.origin.v1）

Agent 通过已验证的 HTTPS 向本地最后确认的 Origin 请求 challenge，并在 `Viorka-Agent-Origin` 请求头中提供该地址。Panel 只在提供此头且地址已变时附加 `migrate_to`，值仅取自管理员保存的 HTTPS Origin。Agent 在候选地址重新获取一次 challenge，严格验证其目标、节点、nonce 与到期时间，随后向原可信地址提交签名。两端须回源到同一个 Panel。短期会话绑定签名中的 Origin，Agent 使用该会话在候选地址建立 WSS。

Agent 在 hello 中声明 `panel.origin.v1`，Panel 仅向支持者返回 `origin_migration: true`。地址变更触发管理连接关闭码 4002，请求重新获取会话。Agent 收到 hello_ack 后原子保存已验证地址，随后通过 node.heartbeat 的可选字段 `applied_origin` 确认。Panel 核对当前节点、会话签名地址和当前目标后记录完成。节点离线、目标 TLS 或认证失败时仍保留最后确认的地址。连续修改目标时以最新保存值为准。

支持 node.cpu_cores.v1 的 Agent 可在 hello_ack 收到 known_cpu_cores（0 表示尚无观测）。仅在协商后通过 heartbeat.cpu_cores 发送与 Panel 已存值不同的 Linux 可见逻辑 CPU 数（1–65536）。启动时采样，每小时复查，采集失败后十分钟重试；重连按 Panel 已提交值对账。

### Agent 自更新

官方安装器管理的 Linux amd64/arm64 服务可在 hello 中声明 `agent.update.v1`。Panel 按当前连接能力派发 `agent.update`，指令仅包含目标节点、固定稳定版标签、对应架构的 SHA-256 和常规任务标识。见 [派发示例](examples/agent.update.json)。Agent 独立验证官方签名和平台。首次执行有十分钟期限；已派发任务可在此后查询已有本地记录，新任务不得借重投越过期限。重连查询沿用同一 task、attempt、目标和 deadline。

`task.ack` 表示本地已持久接收。终态 `task.result` 回显相同的 `agent_update`；成功还要求当前认证会话上报的版本与目标一致。失败码包括 `update_failed`（准备失败）、`update_rolled_back`（旧版已恢复并通过本地检查）和 `update_rollback_failed`（需要人工恢复）。失联超过结果核对窗口时 Panel 记录 `update_result_unknown`。

### Shadowsocks shared outbounds

An Agent supporting Shadowsocks advertises `engine.outbound.shadowsocks.v1` alongside `engine.manage.v8`. An engine command containing a `shadowsocks` outbound requires both capabilities. The outbound carries `method` and `password`. SS2022 accepts one standard Base64 PSK of the length required by the method. Shared outbounds support TCP and UDP routing and the default route.

### Realm 单跳只读检查

可选协商能力 `engine.relay.probe.v1` 扩展 `engine.inspect`。Panel 在 `engine.relay_probe` 中给出 `rule_id` 与 `applied_revision`。入口 Agent 核对本地已应用的托管 Realm 配置与修订，按规则实际监听和转发目标执行有超时的 TCP 检查。结果分别报告 `listen`、`dial` 并回显规则与修订。与普通 inspect 一样，任务的命令修订与已应用配置修订分别处理。示例见[请求](examples/engine.relay-probe.json)与[结果](examples/engine.relay-probe-result.json)。
