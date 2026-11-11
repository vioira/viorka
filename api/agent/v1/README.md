# Agent wire protocol（v1）

`envelope.schema.json` 是权威 Schema；`scripts/generate_protocol.py` 为两个仓库生成带 SHA-256 的模型。Agent 保存同版本 Schema 快照独立校验。示例仅供合约测试，不授予任务执行权限。

2026-11-03 监控契约修订移除了旧 NodeSettings、NodeMetrics 及扩展、旧握手指标/设置字段和相关样例。Envelope 仍为 1.0，监控能力仅支持 `node.telemetry.v3`。新 Panel 不下发或接收旧监控消息，新 Agent 不声明旧能力或回退旧采集；旧 Agent 需要升级。身份注册、心跳、`node.inventory.v1` 和类型化任务协议保持原语义。

新版协商及完整字段见 [TELEMETRY_V3.md](TELEMETRY_V3.md)，实现行为见 [监控说明](../../../docs/MONITORING.md)。独立产品版本不要求同号，但发布需携带此匹配 Schema；工作区同步不等于已发布制品。

2026-11-05 引擎管理能力升级为 `engine.manage.v2`：`EngineService.short_id` 替换为必填 `short_ids` 数组。VLESS 服务包含 1 至 8 个不重复（忽略大小写）的偶数位十六进制值，每项 2 至 16 位；Realm 使用空数组。sing-box 和 Xray 接收完整列表，单条客户端链接使用第一项。Envelope 仍为 1.0，REST 路径不变；旧引擎能力不协商、不降级，新旧 Panel/Agent 需配套升级。本地同步不代表已发布。

2026-11-05 出口与分流新增 `engine.manage.v3`：sing-box `engine.apply` 可携带 `outbounds` 和 `routing`，引用 ID 必须完整对应，规则有序且有界；HTTP CONNECT 仅限 TCP 规则。旧 v1/v2 能力不执行新引擎任务，需配套升级。Envelope 1.0 与 REST v1 保持不变。示例见 `examples/engine.egress.json`，完整说明见 `docs/OUTBOUNDS.md`（Panel 仓库根目录）。

2026-11-06：EngineOutbound 支持普通 VLESS TCP：type=vless、tls=false（或省略），仅使用服务器、端口和 UUID，禁止 REALITY/TLS 字段和 Flow。tls=true 仍要求完整 REALITY 参数。字段及 engine.manage.v3 不变；旧实现明确拒绝普通 TCP，需配套更新 Agent 校验。本次仅本地实现，未发布或部署。

2026-11-07 引擎诊断能力升级为 `engine.manage.v4`。EngineResult 新增可选 diagnostic：stage 为固定执行阶段，message 最多 512 字符、不得含控制字符，interrupted 表示上次执行异常中断，http_status/exit_code 为可选结构化数值。仅失败结果携带诊断，中断标志仅用于 engine_result_unknown；不传原始日志、配置、凭据或下载 URL。Agent 在阶段副作用前持久化 stage，任务重投时将最后阶段随中断结果补报。没有系统 OOM 证据时不标记“内存不足”。Envelope 保持 1.0；新 Panel/Agent 只协商 v4，引擎管理需配套更新，旧 v3 不混用。已持久化旧任务无 diagnostic 时仍可展示错误码。本地协议同步不等于发布。

2026-11-07 引擎能力升级为 `engine.manage.v5`，Envelope 仍为 1.0。新增诊断阶段 verify_binary/install_dependencies，错误码 engine_dependency_missing/engine_dependency_install_failed/engine_binary_unusable。安装、升级、应用配置和启动引擎默认自动修复白名单依赖，无新增用户确认字段；只读检查只检测和报告。系统包安装仅限 Agent 固定官方仓库、固定包名/版本，保留 APK 签名校验。Panel/Agent 需配套发布，v4 不声明 v5 能力，不派发新引擎任务。

### 注册恢复托管引擎

`POST /api/v1/agents/enroll` 支持可选 `engines: EngineRecovery[]`（最多 3 项，请求体最多 3 MiB）。Agent 在显式新注册时核对本机托管服务、二进制与有效配置，并携带原 `engine_id`、完整 `command` 和真实 `running/stopped` 状态；秘密只经 TLS 传递。Panel 在注册事务中恢复缺失的引擎记录，同节点已有记录不覆盖、其他节点仍持有的 ID 拒绝，令牌重试仍按原 token/key 绑定。原节点换钥不需要上传快照。该扩展要求配套 Panel；不改变 WSS 任务能力版本。

2026-11-11 引擎能力升级为 `engine.manage.v6`。`engine.inspect` 可携带 `include_config=true`，成功结果返回 `configuration`（实际配置修订号和完整原生文件列表）。Agent 先校验托管归属、活动文件及进程健康，再返回读取结果；失败不返回配置。JSON 凭证字段原样返回，Panel 加密保存，仅通过节点管理授权的专用接口读取，Realm 仅接受托管 TCP 转发格式。配置正文合计不超过 32 KiB，序列化后不超过 48 KiB，保持 64 KiB Envelope 上限。Panel/Agent 必须配套更新，v5 不派发 v6 引擎任务。
