# Agent wire protocol（v1）

- `envelope.schema.json` 是协议包装结构的权威 Schema 草案。
- `examples/*.json` 是测试样例而非可直接调用的线上接口。
- 业务消息行为、鉴权、版本和任务语义详见 `../../../docs/PROTOCOL.md`。
- Agent 仓库 `protocol/v1` 为当前起步数据模型，M0 要改成固定协议 tag 的自动生成结果。
- JSON Schema 可校验字段形状，但不能独立证明业务幂等、签名和跨版本兼容，必须做端到端合约测试。
