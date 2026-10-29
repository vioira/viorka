# Viorka 交付路线图（建议）

> 按 MVP → 增量交付，不为未来多实例过度设计。每阶段的完成条件是可测试、可演示，不是仅创建空包。

| 阶段 | 功能 | 必须通过的验收标准 | 优先级 |
|---|---|---|---|
| **M0 基础与通信** | 双仓库、协议代码生成、Panel 用户认证、Agent 注册/WSS、SQLite 驱动/迁移、事件推送 | 在本机与 NAT VPS 能注册/吊销/重连；断线不影响已有进程；API 有认证；重复消息不触发错误副作用 | P0 |
| **M1 服务器资产** | 节点资产、地址/端口映射、OS/架构探测、资源监控、任务中心、审计 | NAT 映射显示公私端口；节点状态准确；任务断线恢复；分钟指标受限写入 | P0 |
| **M2 代理服务编排** | sing-box/Xray adapter、服务 CRUD、引擎安装/启动/停止、配置校验/Revision/回滚 | 真实节点发布，失败后恢复旧配置；未知管理权限不接管已有引擎；无 root shell 注入 | P0 |
| **M3 拓扑与 Relay** | Realm adapter、入口/出口/中转、链路依赖、端口冲突/可达性 | Relay→NAT→代理链路端到端测试；无 UDP 节点拒绝 UDP；映射不匹配明确提示 | P1 |
| **M4 客户端与运维** | Mihomo/Loon 等订阅、告警、备份、升级、指标优化 | 订阅密钥可撤销；升级有签名验证和回滚；恢复备份可验证 | P1 |
| **M5 扩展** | 多用户作用域、任务 Worker 拆分、PostgreSQL、Gateway 横向扩展 | 可替换 SQLite、跨实例保证任务幂等和连接路由，完整升级回退路径 | P2 |

## M0 推荐拆解为 Issues

1. `server: auth + user/session API (RBAC skeleton)`。
2. `server: SQLite migration runner + repository interfaces`。
3. `protocol: canonical schema + generation + compatibility CI`。
4. `agent: enrollment + local identity storage + session challenge`。
5. `server: WSS gateway + authenticated node sessions + heartbeat`。
6. `agent: WSS reconnect/backpressure/heartbeat`。
7. `server: task table + idempotency + persistent dispatcher`。
8. `web: login shell + node enrollment + SSE client`。
9. `e2e: fault injection (panel restart, duplicate tasks, TLS mismatch, NAT outbound)`。

## M1/M2 优先可用路径

先让用户在 Panel 中创建 NAT 节点并录入“公网:端口 → 内网:端口”，然后让 Agent 能安装一个引擎、部署一个配置、失败可回滚，最后再扩展多用户/订阅/多节点中转。避免一开始实现庞杂的自定义配置编辑器却无法可靠下发。

## 发布门槛

- 文档、API 和示例始终区分**已实现**与**计划中**。
- 发布前必须完成安全关键项：密钥与 Secret 管理、审计、权限、任务去重、TLS、更新供应链。
- 正式 UI 上所有可操作按钮必须有真实持久化状态和反馈，不展示模拟成功。
