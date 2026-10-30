# 开发与部署手册

M0 当前运行、TLS、管理员初始化、Agent 接入和备份恢复见 [GETTING_STARTED.md](GETTING_STARTED.md)。

现有 `deploy/` Compose/systemd 示例来自脚手架，未随本轮修改：没有可写 SQLite 持久化卷，不可直接作为 M0 部署方案。Go 仍不内嵌 Web 文件，构建产物 `web/dist` 需单独托管。生产验收仍需真实 NAT VPS、反向代理和长期资源测试。

## 启动配置

复制根目录 `.env.example` 为 `.env` 后配置启动参数；系统环境变量优先，也可用 `VIORKA_ENV_FILE` 指定文件。用户名默认为 `admin`，空库首次启动自动生成密码并写入数据库同目录的 `0600` 私有文件，日志仅显示路径。已有用户不重置；完整格式和密码读取方式见 [GETTING_STARTED.md](GETTING_STARTED.md)。

## 接入边界

- 默认 Panel 监听 127.0.0.1:8080，数据库 data/viorka.db，Web 开发 Origin 为 http://127.0.0.1:5173。
- Web、REST、SSE 和 Agent HTTPS/WSS 使用同一生产 Origin；`VIORKA_ORIGIN` 精确匹配，不带路径。
- 反向代理需透传 WebSocket Upgrade/Authorization、关闭 SSE 缓冲；不得记录令牌、Cookie 或请求体。
- Agent 仅需出站 TCP/TLS，不要求入站管理端口或 UDP。
- Panel 只支持单进程数据库所有权，不能共享同一 SQLite 文件运行多个实例。
- `/readyz` 实际 Ping SQLite，不代表 Agent 在线或引擎可用。

## 设置与备份恢复

启动时首次以 `VIORKA_ORIGIN` 初始化持久化设置，之后以已保存的公开 Origin 为准。Origin 修改须重启生效；不要先关闭旧地址，应先准备新地址证书、反向代理和 Agent 连接配置。

备份目录为 `<VIORKA_DATABASE>.backups`，目录 0700、文件 0600。每天 03:00 UTC 执行自动备份（启动时补做当天错过的备份）；管理员也可手动创建。备份保存前验证完整性并加密，明文临时文件在操作结束时清除；限制单快照 256 MiB、最多 100 份，自动备份清理 14 天以前的受管文件。达到数量限制时需先在停机维护期间归档旧备份。恢复计划中的文件不会被清理。

恢复流程：在“安全与备份”选中快照，输入当前密码并确认，界面显示等待重启；停止唯一的 Panel 进程后再启动。启动会验证快照，checkpoint 当前数据库，保留 `.before-restore-*` 副本后替换；使用备份中的账号重新登录，Agent 自动重新握手。恢复前可取消计划。校验失败时启动终止并保留原库与计划；检查磁盘权限、快照与密钥，必要时离线移走 `.backups/restore.json` 取消计划。恢复前副本可能含敏感数据，须另行加密归档。
