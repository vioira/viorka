# Agent wire protocol（v1）

`envelope.schema.json` 是权威 Schema；`scripts/generate_protocol.py` 为两个仓库生成带 SHA-256 的模型。Agent 保存同版本 Schema 快照独立校验。示例仅供合约测试，不授予任务执行权限。

2026-11-03 监控契约修订移除了旧 NodeSettings、NodeMetrics 及扩展、旧握手指标/设置字段和相关样例。Envelope 仍为 1.0，监控能力仅支持 `node.telemetry.v3`。新 Panel 不下发或接收旧监控消息，新 Agent 不声明旧能力或回退旧采集；旧 Agent 需要升级。身份注册、心跳、`node.inventory.v1` 和类型化任务协议保持原语义。

新版协商及完整字段见 [TELEMETRY_V3.md](TELEMETRY_V3.md)，实现行为见 [监控说明](../../../docs/MONITORING.md)。独立产品版本不要求同号，但发布需携带此匹配 Schema；工作区同步不等于已发布制品。

2026-11-05 引擎管理能力升级为 `engine.manage.v2`：`EngineService.short_id` 替换为必填 `short_ids` 数组。VLESS 服务包含 1 至 8 个不重复（忽略大小写）的偶数位十六进制值，每项 2 至 16 位；Realm 使用空数组。sing-box 和 Xray 接收完整列表，单条客户端链接使用第一项。Envelope 仍为 1.0，REST 路径不变；旧引擎能力不协商、不降级，新旧 Panel/Agent 需配套升级。本地同步不代表已发布。
