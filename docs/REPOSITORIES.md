# 双仓库边界与版本策略

## 仓库定义

| 项目 | 预期 GitHub 地址* | 主要开发语言 | 构建产物 |
|---|---|---|---|
| 控制平面 | `github.com/vioira/viorka` | Go、TypeScript | `viorka-server`、Web 静态文件、Docker 镜像 |
| 节点执行平面 | `github.com/vioira/viorka-agent` | Go | `viorka-agent`、linux amd64/arm64 binaries |

\* 地址是命名方案，尚未验证仓库/组织归属；如实际 Owner 不同，请同步修改 module path。

**独立项目意味着**：Agent 有自己的 Issue、PR、版本、Releases、CI；Panel 不 `git submodule` 绑定某个 Agent 源码版本，也不在同仓库把 Agent 作为 `./agent` 子目录维护。

## 共享契约方案

- 单一规范源：`viorka/api/agent/v1/`。采用 JSON Schema 描述消息 Envelope，详细行为由 `docs/PROTOCOL.md` 规范。
- Agent 通过**固定 tag/commit** 的规范生成客户端类型；禁止构建时自动抓取主分支最新协议。
- `scripts/generate_protocol.py` 从 Schema 生成双仓库 Go 类型；生成结果包含 Schema SHA-256，CI 校验漂移。双进程联测使用 `scripts/e2e_agent_connection.py`。当前为本地开发契约，首次发布还需固定 tag/commit。
- Schema 修改应通过向后兼容的 PR，增加样例测试用例，然后再发 Agent。

## 兼容性策略（建议）

- 传输消息版本 `major.minor`（示例 Envelope 固定 `1.0`）；不兼容改动提升 major，增加可选字段提升 minor。
- Panel 先接受现有 Agent 主版本的旧消息，再灰度发新版 Agent；不要要求所有节点强制同步更新。
- Agent 启动时上报 `agent_version`、`protocol_versions` 和 `capabilities`；Panel 在分发任务前检查能力。
- 新操作必须能被旧 Agent 明确拒绝，不能依赖未知字段实现隐式降级。
- 兼容窗口建议支持当前稳定主版本和上一个稳定主版本，具体由 Release Policy 固定。

## 版本样例

```text
Panel:  viorka-server 0.7.0
Agent:  viorka-agent 0.5.3
Wire:   agent-envelope 1.0
```

这些只是版本格式示例，**不是已经发布的版本**。

## Release / CI

- 主仓库：Go Test + 静态分析 + Web Build + Schema 校验 + Migration Test + Docker 构建。
- Agent：Go Test + Linux amd64/arm64 交叉编译 + 协议合约 + runtime adapter 的模拟测试。
- 正式发行前：SHA-256、制品签名、SBOM、版本变更说明、安全公告流程；不要在 Web 中自行拼接下载来源。
- 首次发布的默认安装方式应提供可核验的预编译文件，不依赖 Debian 特定 GLIBC 版本。

## 跨仓库变更顺序

1. 先提交协议草案、兼容性测试和 ADR 到 Panel 仓库。
2. Agent 增加兼容实现，并通过旧/新协议样例测试。
3. Panel 打开新功能开关，待覆盖率达到目标后再默认启用。
4. 最后按生命周期弃用旧字段；不得未经迁移直接删除。
