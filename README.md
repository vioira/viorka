# Viorka

**Unified Infrastructure & Proxy Orchestration** · by Vioira

Viorka 是一个面向 VPS、NAT VPS 与代理/中转服务的统一管理平台。主仓库提供 Panel 后端、Web Console、任务/编排模型和平台侧协议定义；节点 Agent 是**完全独立的仓库**：[`viorka-agent`](../viorka-agent/)。

> 项目状态：**M0 本机基础闭环已实现，实机验收待完成**。已接通 SQLite、用户认证、Agent 注册/WSS、只读持久任务和 Arc Web 界面。启动步骤及限制见 [GETTING_STARTED.md](docs/GETTING_STARTED.md)。代理引擎编排仍未实现。

## 核心原则

1. 服务器资源管理与代理服务编排 **同等重要**。
2. **控制平面与数据平面隔离**：Panel/Agent 不转发用户代理流量。
3. Agent **主动出站连接** Panel；NAT 节点无需新增入站管理端口。
4. **声明式期望状态 + 有版本的任务**；失败可检查并尽力回滚。
5. 默认单实例 SQLite，预留 PostgreSQL/Worker/多 Gateway 演进路径。
6. Agent 严格最小权限；禁止通用远程 Shell 控制作为默认任务能力。

## 目录

```text
viorka/
├── cmd/server/           # Panel Server 可执行入口
├── internal/             # Go 后端业务模块（多数为接口预留）
├── api/openapi/          # Panel REST API 草案（实际接口如实标记）
├── api/agent/v1/         # Agent 协议规范的唯一源头
├── web/                  # React + TypeScript + Vite 前端
├── migrations/           # SQLite 版本迁移与嵌入资源
├── deploy/               # Compose、Dockerfile、服务管理示例
├── docs/                 # 架构、安全、协议、数据、NAT、里程碑、ADR
└── scripts/              # 本地验证脚本
```

## 运行当前已实现的最小后端

需要 Go 1.26+：

```bash
go test ./...
go run ./cmd/server
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/api/v1/version
```

默认只监听 `127.0.0.1:8080`。非本机监听要求显式 TLS 证书/私钥和 HTTPS Origin 配置。

Web 开发：

```bash
cd web
pnpm install --frozen-lockfile
pnpm run dev
```

前端开发代理默认指向 `http://127.0.0.1:8080`。前端提供真实登录、注册令牌、节点连接状态、只读检查与身份吊销。初始化管理员和 HTTPS Agent 接入见 M0 指南。

## 文档索引

| 文档 | 内容 |
|---|---|
| [架构总览](docs/ARCHITECTURE.md) | 模块划分、通信拓扑、数据与控制边界 |
| [仓库与版本](docs/REPOSITORIES.md) | 独立 Agent、共享协议、发布策略 |
| [Agent 协议](docs/PROTOCOL.md) | HTTPS/WSS、安全、消息、幂等、重连 |
| [数据模型](docs/DATABASE.md) | 表关系、迁移、SQLite 升级策略 |
| [安全设计](docs/SECURITY.md) | 威胁边界、凭证、权限、任务安全 |
| [NAT 和中转](docs/NAT_AND_RELAY.md) | 端口映射、Relay、网络拓扑 |
| [部署与开发](docs/DEPLOYMENT.md) | Compose、反向代理、安全限制 |
| [路线图](docs/ROADMAP.md) | M0–M5 交付与验收 |
| [架构决策记录](docs/decisions/) | ADR |

## 仓库/许可证

预期仓库：`github.com/vioira/viorka`（请在建仓前核对组织名）。许可证未确定，正式公开前请补充 `LICENSE`。欢迎将系统设计讨论整理为 Issue / ADR。
