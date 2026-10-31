# Agent wire protocol（v1）

- `envelope.schema.json` 是协议包装结构的权威 Schema 草案。
- `examples/*.json` 是测试样例而非可直接调用的线上接口。
- 业务消息行为、鉴权、版本和任务语义详见 `../../../docs/PROTOCOL.md`。
- `scripts/generate_protocol.py` 生成 Panel/Agent 的 `protocol/v1/models.gen.go`，携带 Schema SHA-256。Agent 携带 Schema 和生成器快照独立检查，正式发布 tag 尚待固定。
- JSON Schema 可校验字段形状，但不能独立证明业务幂等、签名和跨版本兼容，必须做端到端合约测试。

## `node.metrics.v1` 扩展

保持外层协议 1.0。Agent 在 `system.hello.capabilities` 宣告 `node.metrics.v1`；Panel 仅对这些 Agent 在 hello_ack 加入 `metrics_version: 1`。Agent 未收到确认时不得发送 `node.metrics`。旧 Agent 的 ACK 保持原结构。

`NodeMetrics` 与各指标组由本目录 Schema 定义，示例见 `examples/node.metrics.json`。时间 UTC，容量/流量单位 bytes，速率 bytes/s，CPU 百分比 0–100。缺失指标组必须有对应固定 error code，首次 CPU/网络差值缺省，不能补零。数据有效性及缓存语义见 `docs/MONITORING.md`（相对仓库根目录）。当前为工作区扩展，需随匹配的 Panel/Agent release 发布。

### node.inventory.v1（可选资产扩展）

协议 Envelope 保持 1.0。Agent 在 hello capabilities 声明 `node.inventory.v1`；Panel 仅对此能力返回 `inventory_version: 1`，Agent 仅在确认后发送 `node.inventory`。新 Agent + 旧 Panel 保留基础 hello；旧 Agent + 新 Panel 不收到新增 ACK 字段。Schema、Go 模型和示例已同步到 Agent 仓库，发布 tag 尚未创建。

`NodeInventory` 含 UTC `sampled_at`、`os_id/os_name/os_version`、`public_ipv4/public_ipv6` 和错误代码数组。地址为空时必须带对应 `public_ipv4_unavailable/public_ipv6_unavailable`，发行版名称为空时带 `os_release_unavailable`。每族表示一个已验证格式的公网出口地址，不保证入站可达，也不修改 NAT 映射。Gateway 检查会话身份、能力、长度、时间、地址族和错误状态一致性；未经协商、错误族、私网、环回地址均拒绝。正常每 5 分钟更新，重连可重发缓存，过期或未来时间超出窗口的消息拒绝。

### node.settings.v2 与 node.metrics.v2

新 Agent 同时宣告 node.metrics.v1/v2，只宣告 node.settings.v2。Panel 优先确认 metrics_version=2，接收 node.metrics_batch（1–10 个严格递增样本，每帧最多 64 KiB）；v1 Agent 仍收 metrics_version=1 并发送单快照。新设置经 collection_settings 返回，范围/默认值为 collection_seconds 0–10/0、report_seconds 30–180/60、wss_report_seconds 1–5/2。资产刷新独立 300 秒。0 表示随实时上报采集；重复快照沿用原始 sampled_at，不重复统计。

旧 node_settings 保留为 LegacyNodeSettings 的 Schema 和示例，但新 Panel 不再下发这个旧语义字段。没有协商 v2 的旧 Agent 不会收到 collection_settings。新 Agent 连接旧 Panel 时使用本地周期。保存设置只重连管理会话，不影响代理进程。

示例：examples/system.hello_ack_v2.json、examples/node.metrics_batch.json。持久化、时间桶、未知值、重试和兼容矩阵见仓库 docs/MONITORING.md。

### node.host_metrics.v1

保持外层 1.0 和 metrics_version 1/2。Agent 宣告 `node.host_metrics.v1`，
Panel 仅对宣告该能力且启用监控的 Agent 返回 `host_metrics_version: 1`。
确认后 NodeMetrics 可携带 `host`，包含按设备的磁盘读写 bytes/bytes/s、
IPv4+IPv6 TCP/UDP inuse 套接字数及可见进程数；示例 `examples/node.metrics_host.json`。
未确认的 Agent 必须省略 host，防止旧 Panel 的严格解码拒绝整个样本。
旧 Agent 不发送 host，新 Panel 接受；未支持平台仍使用原有 unsupported_platform。
host 内各组缺失由其 errors 明确说明；无速率表示尚无有效差值，不补零。
磁盘标识为 major:minor:name，不得将整盘、分区、堆叠设备直接累加。
该扩展需随匹配制品发布，当前未修改历史聚合和界面。
