# 开发约定与模块依赖

## 开发先决条件

- Go 1.23+（此脚手架的编译基线，不代表要求使用最新 Go）。
- Node.js 22 + npm（Web 预览需要下载 React/Vite 依赖）。
- Python 3（用于简单 JSON/协议文件检查；正式协议代码生成器 M0 开发）。
- SQLite CLI（可选：检查 schema，无需进入运行时）。

## 工作流

```bash
cd viorka
./scripts/validate.sh
# Web
cd web
npm install
npm run build
```

`./scripts/validate.sh` 验证 Go 格式、Go 单测/编译和 JSON 语法，**不做**真实协议兼容或数据库集成测试，后续补充。

## 模块依赖方向

```text
cmd/server → internal/app → internal/httpapi → application services
                                      ↘ domain
application services → domain interfaces ← storage adapters
Agent Gateway → message protocol + Task Dispatcher
```

- `domain` 不应该引用 HTTP/数据库、Web/Agent 传输。
- 不允许 `orchestrator` 直接调用节点系统命令；所有执行都通过受控 Agent task。
- 将跨域业务操作（部署服务及 NAT 映射）建成用例并测试任务状态机。
- 每个添加的 REST 端点先更新 OpenAPI 及错误码，再实现和补测试。

## 代码风格

- Go：`gofmt`、小接口、context cancellation、明确超时、结构化日志。
- TypeScript：strict、类型化 API DTO、前端不维护第二份业务规则。
- 避免用 TODO 空函数返回成功；若未实现应给明确的 `not_implemented` 错误。
- 任何用于日志的错误摘要都必须排除密码、令牌、私钥、完整配置。

## Commit/PR 验收

- 单仓库独立 CI，通过后才能合并。
- 协议改动要考虑旧版本 Agent，提供对应 JSON example、合约测试和迁移说明。
- 数据模型改动要有迁移、约束和备份恢复测试。
- 代理核心版本/命令行参数不能盲目假设兼容；需在适配器能力检测下测试。

## 许可证与贡献流程

许可证尚未确定，不要自行贴第三方仓库 LICENSE。公开发布前制定贡献指南、治理规范和安全漏洞披露邮箱。
