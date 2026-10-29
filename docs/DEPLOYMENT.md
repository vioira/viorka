# 开发与部署手册

M0 当前运行、TLS、管理员初始化、Agent 接入和备份恢复见 [GETTING_STARTED.md](GETTING_STARTED.md)。

现有 `deploy/` Compose/systemd 示例来自脚手架，未随本轮修改：没有可写 SQLite 持久化卷，不可直接作为 M0 部署方案。Go 仍不内嵌 Web 文件，构建产物 `web/dist` 需单独托管。生产验收仍需真实 NAT VPS、反向代理和长期资源测试。

## 接入边界

- 默认 Panel 监听 127.0.0.1:8080，数据库 data/viorka.db，Web 开发 Origin 为 http://127.0.0.1:5173。
- Web、REST、SSE 和 Agent HTTPS/WSS 使用同一生产 Origin；`VIORKA_ORIGIN` 精确匹配，不带路径。
- 反向代理需透传 WebSocket Upgrade/Authorization、关闭 SSE 缓冲；不得记录令牌、Cookie 或请求体。
- Agent 仅需出站 TCP/TLS，不要求入站管理端口或 UDP。
- Panel 只支持单进程数据库所有权，不能共享同一 SQLite 文件运行多个实例。
- `/readyz` 实际 Ping SQLite，不代表 Agent 在线或引擎可用。
