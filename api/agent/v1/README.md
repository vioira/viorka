# Agent wire protocol（v1）

`envelope.schema.json` 是权威 Schema；`scripts/generate_protocol.py` 为两个仓库生成带 SHA-256 的模型。Agent 保存同版本 Schema 快照独立校验。示例仅供合约测试，不授予任务执行权限。

2026-11-03 监控契约修订移除了旧 NodeSettings、NodeMetrics 及扩展、旧握手指标/设置字段和相关样例。Envelope 仍为 1.0，监控能力仅支持 `node.telemetry.v3`。新 Panel 不下发或接收旧监控消息，新 Agent 不声明旧能力或回退旧采集；旧 Agent 需要升级。身份注册、心跳、`node.inventory.v1` 和类型化任务协议保持原语义。

新版协商及完整字段见 [TELEMETRY_V3.md](TELEMETRY_V3.md)，实现行为见 [监控说明](../../../docs/MONITORING.md)。独立产品版本不要求同号，但发布需携带此匹配 Schema；工作区同步不等于已发布制品。

2026-11-05 引擎管理能力升级为 `engine.manage.v2`：`EngineService.short_id` 替换为必填 `short_ids` 数组。VLESS 服务包含 1 至 8 个不重复（忽略大小写）的偶数位十六进制值，每项 2 至 16 位；Realm 使用空数组。sing-box 和 Xray 接收完整列表，单条客户端链接使用第一项。Envelope 仍为 1.0，REST 路径不变；旧引擎能力不协商、不降级，新旧 Panel/Agent 需配套升级。本地同步不代表已发布。

2026-11-05 出口与分流新增 `engine.manage.v3`：sing-box `engine.apply` 可携带 `outbounds` 和 `routing`，引用 ID 必须完整对应，规则有序且有界；HTTP CONNECT 仅限 TCP 规则。旧 v1/v2 能力不执行新引擎任务，需配套升级。Envelope 1.0 与 REST v1 保持不变。示例见 `examples/engine.egress.json`，完整说明见 `docs/OUTBOUNDS.md`（Panel 仓库根目录）。

2026-11-06：EngineOutbound 支持普通 VLESS TCP：type=vless、tls=false（或省略），仅使用服务器、端口和 UUID，禁止 REALITY/TLS 字段和 Flow。tls=true 仍要求完整 REALITY 参数。字段及 engine.manage.v3 不变；旧实现明确拒绝普通 TCP，需配套更新 Agent 校验。本次仅本地实现，未发布或部署。
