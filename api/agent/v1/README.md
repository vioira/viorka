# Agent wire protocol（v1）

- `envelope.schema.json` 是协议包装结构的权威 Schema 草案。
- `examples/*.json` 是测试样例而非可直接调用的线上接口。
- 业务消息行为、鉴权、版本和任务语义详见 `../../../docs/PROTOCOL.md`。
- `scripts/generate_protocol.py` 生成 Panel/Agent 的 `protocol/v1/models.gen.go`，携带 Schema SHA-256。Agent 携带 Schema 和生成器快照独立检查，正式发布 tag 尚待固定。
- JSON Schema 可校验字段形状，但不能独立证明业务幂等、签名和跨版本兼容，必须做端到端合约测试。

## `node.metrics.v1` 扩展

保持外层协议 1.0。Agent 在 `system.hello.capabilities` 宣告 `node.metrics.v1`；Panel 仅对这些 Agent 在 hello_ack 加入 `metrics_version: 1`。Agent 未收到确认时不得发送 `node.metrics`。旧 Agent 的 ACK 保持原结构。

`NodeMetrics` 与各指标组由本目录 Schema 定义，示例见 `examples/node.metrics.json`。时间 UTC，容量/流量单位 bytes，速率 bytes/s，CPU 百分比 0–100。缺失指标组必须有对应固定 error code，首次 CPU/网络差值缺省，不能补零。数据有效性及缓存语义见 `docs/MONITORING.md`（相对仓库根目录）。当前为工作区扩展，需随匹配的 Panel/Agent release 发布。
