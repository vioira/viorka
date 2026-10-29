# 开发与部署手册（脚手架阶段）

> ⚠️ 当前仅有 HTTP 基础接口，没有用户鉴权/Agent WSS 网关，**不得直接暴露为互联网生产管理面板**。

## 本地运行

```bash
cd viorka
go test ./...
VIORKA_LISTEN=127.0.0.1:8080 go run ./cmd/server
# 在另一个终端
curl -i http://127.0.0.1:8080/healthz
curl -i http://127.0.0.1:8080/readyz
curl -i http://127.0.0.1:8080/api/v1/version
```

`/readyz` 当前只说明 HTTP Handler 可处理请求，不代表后端具备数据库、Agent Gateway 或真实业务能力。

## Web Console（预览）

```bash
cd viorka/web
npm install
npm run dev
```

Vite 默认仅本地 `127.0.0.1` 监听，通过 `/api` 开发代理访问 Go Server。构建使用 `npm run build`，产物在 `web/dist/`。当前 API-only Go Server **不内嵌 Web 文件**，两者单独运行。

## Docker Compose（API-only 演示）

```bash
cd viorka/deploy
docker compose -f compose.yaml up --build -d
docker compose -f compose.yaml ps
curl http://127.0.0.1:8080/healthz
```

Compose 只把服务绑定到宿主机 `127.0.0.1:8080`，并采用只读容器文件系统；当前没有真正的数据库卷。**M0 启用 SQLite 后必须提供 `/data` 可写持久化卷、迁移和备份方案**，不能沿用此只读示例就假称数据持久化。

## 计划中的生产拓扑

```text
Internet
    │ HTTPS 443
    ▼
TLS reverse proxy (Caddy/Nginx, request limits)
    ├── /             -> Web 静态文件（或 Go embed）
    ├── /api/v1/*     -> Panel REST（用户鉴权）
    ├── /api/v1/events -> Panel SSE
    └── /api/v1/agents/ws -> Agent WSS（独立认证）
                              |
                           Agent Outbound
```

- 代理必须正确透传 WebSocket Upgrade/Authorization 头并允许长连接。
- 建议先通过 443/TCP 统一入口，满足无 UDP/QUIC 的 NAT 出口。
- 生产设置 TLS 强制、HSTS、限流、请求体上限；设置升级/空闲超时适配心跳。
- `X-Forwarded-*` 只能信任配置过的反向代理，禁止由任意外部客户端伪造。
- 在未接入认证/授权/审计前，不要通过公网直接提供管理员 API。

## 系统服务

`deploy/systemd/viorka-server.service.example` 是示例，不是生产安装器。M0 实现后补充：专属系统用户、数据目录权限、配置密钥外置（避免环境泄漏）、日志轮转、定时备份、启动迁移和真正的 Readiness 依赖检查。

## 端口与防火墙

- Panel 管理接入：TCP/443（反向代理）。Go API 仅监听 localhost 或 Docker 内网。
- Agent：仅需要出站访问 Panel 443/TCP；正常情况下无管理入站端口。
- 代理业务端口：仅按每台节点实际需求放行；NAT 公网映射须由服务商分配或授权修改。

## 上线前检查

- [ ] TLS + 登录认证 + RBAC + CSRF/CORS 安全边界
- [ ] Agent 实际注册和 WSS，密钥吊销、重连、背压测试
- [ ] 可恢复 SQLite 迁移、备份、恢复和权限
- [ ] 配置密钥加密与脱敏、审计
- [ ] Agent 签名制品、受控安装、卸载和自动回滚
- [ ] 真实 sing-box/Xray 验证/回滚和网络故障测试
- [ ] 版本和协议兼容性校验
