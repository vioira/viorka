# Agent wire protocol（v1）

- `envelope.schema.json` 是协议包装结构的权威 Schema 草案。
- `examples/*.json` 是测试样例而非可直接调用的线上接口。
- 业务消息行为、鉴权、版本和任务语义详见 `../../../docs/PROTOCOL.md`。
- `scripts/generate_protocol.py` 生成 Panel/Agent 的 `protocol/v1/models.gen.go`，携带 Schema SHA-256。Agent 携带 Schema 和生成器快照独立检查，正式发布 tag 尚待固定。
- JSON Schema 可校验字段形状，但不能独立证明业务幂等、签名和跨版本兼容，必须做端到端合约测试。
