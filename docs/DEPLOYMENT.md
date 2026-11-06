# 开发与部署手册

M0 当前运行、TLS、管理员初始化、Agent 接入和备份恢复见 [GETTING_STARTED.md](GETTING_STARTED.md)。

现有 `deploy/` Compose/systemd 示例来自脚手架，未随本轮修改：没有可写 SQLite 持久化卷，不可直接作为 M0 部署方案。Go 仍不内嵌 Web 文件，构建产物 `web/dist` 需单独托管。生产验收仍需真实 NAT VPS、反向代理和长期资源测试。

## 启动配置

复制根目录 `.env.example` 为 `.env` 后配置启动参数；系统环境变量优先，也可用 `VIORKA_ENV_FILE` 指定文件。用户名默认为 `admin`，空库首次启动自动生成密码并写入数据库同目录的 `0600` 私有文件，日志仅显示路径。已有用户不重置；完整格式和密码读取方式见 [GETTING_STARTED.md](GETTING_STARTED.md)。

## 接入边界

- 默认 Panel 监听 127.0.0.1:8080，数据库 data/viorka.db，Web 开发 Origin 为 http://127.0.0.1:5173。
- 建议 Web、REST、SSE 和 Agent HTTPS/WSS 使用同一生产 Origin；公开 Origin 不带路径。额外浏览器来源使用下述白名单。
- 反向代理需透传 WebSocket Upgrade/Authorization、关闭 SSE 缓冲；不得记录令牌、Cookie 或请求体。
- Agent 仅需出站 TCP/TLS，不要求入站管理端口或 UDP。
- Panel 只支持单进程数据库所有权，不能共享同一 SQLite 文件运行多个实例。
- `/readyz` 实际 Ping SQLite，不代表 Agent 在线或引擎可用。

## 设置与备份恢复

启动时首次以 `VIORKA_ORIGIN` 初始化持久化设置，之后以已保存的公开 Origin 为准。Origin 修改须重启生效；不要先关闭旧地址，应先准备新地址证书、反向代理和 Agent 连接配置。

备份目录为 `<VIORKA_DATABASE>.backups`，目录 0700、文件 0600。每天 03:00 UTC 执行自动备份（启动时补做当天错过的备份）；管理员也可手动创建。备份保存前验证完整性并加密，明文临时文件在操作结束时清除；限制单快照 256 MiB、最多 100 份，自动备份清理 14 天以前的受管文件。达到数量限制时需先在停机维护期间归档旧备份。恢复计划中的文件不会被清理。

恢复流程：在“安全与备份”选中快照，输入当前密码并确认，界面显示等待重启；停止唯一的 Panel 进程后再启动。启动会验证快照，checkpoint 当前数据库，保留 `.before-restore-*` 副本后替换；使用备份中的账号重新登录，Agent 自动重新握手。恢复前可取消计划。校验失败时启动终止并保留原库与计划；检查磁盘权限、快照与密钥，必要时离线移走 `.backups/restore.json` 取消计划。恢复前副本可能含敏感数据，须另行加密归档。

## 多个浏览器请求来源

可在 `.env` 或进程环境中配置额外可信来源，重启生效：

```dotenv
VIORKA_ALLOWED_ORIGINS=https://console.example.com,https://admin.example.com
```

当前生效的公开 Origin 始终允许，额外列表不改变 Agent 签名绑定、安装地址或设置中的 `active_origin`。列表独立于数据库设置，留空保持单来源；最多 32 项，去除项首尾空白并去重。每项必须是精确 HTTP(S) Origin，不带路径、末尾斜线、用户信息、查询或 fragment，不支持通配符；HTTP 仅允许 localhost/loopback。无效配置拒绝启动。

Web API 的 CORS 响应只回显匹配的来源，允许凭证并设置 `Vary: Origin`。OPTIONS 预检允许 GET/HEAD/POST/PUT/PATCH/DELETE，以及 Content-Type、X-CSRF-Token、Last-Event-ID 请求头；预检通过不代表接口存在或用户获授权。登录、邀请接受及已认证写操作统一使用此来源白名单，写操作仍校验 CSRF Token。Agent 接口不启用 CORS，WSS 仍拒绝浏览器 Origin。

Cookie 保持 HttpOnly、SameSite=Strict 和原有 Secure 策略。多来源配置适用于同站不同子域/端口等部署，不会放开跨站 Cookie；例如 localhost 与 127.0.0.1 不是同一站点。前后端分离时浏览器客户端须携带凭证，SSE 同样需要凭证；跨站部署应通过同站反向代理接入。

### 节点 IP 地区数据库

Panel 可读取本地 MaxMind GeoLite2 City 或 GeoIP2 City MMDB：

```sh
VIORKA_GEOIP_DATABASE=/absolute/path/to/GeoLite2-City.mmdb
```

从 [MaxMind GeoLite2](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/) 获取数据库，遵守其账号、下载和许可要求。数据库不随仓库分发，也不会由 Panel 自动下载；请由部署方定期更新，替换文件后重启 Panel 以重新加载和解析。不要原地修改运行中已打开的 MMDB 文件。

未配置该变量时不运行地区解析，未解析节点显示“地区未知”。显式配置了不存在、损坏或非 City 类型的数据库时，Panel 启动报错，不静默忽略配置。查询在本地进行，不向第三方提交节点 IP。IP 地区代表公网出口归属地，尤其对 NAT 节点不等于机房实际位置。

### 通行密钥和登录来源

通行密钥要求浏览器安全上下文。使用与浏览器地址完全一致的 `VIORKA_ORIGIN=https://panel.example.com`，开发可用 `http://localhost`。WebAuthn 只接受该公开 Origin，额外 CORS 来源不会自动成为通行密钥来源。RP ID 是其主机名，改变域名后旧密钥不能用于新域名，应使用密码登录并重新注册。

反向代理后需要真实客户端 IP 时，显式设置 `VIORKA_TRUSTED_PROXIES=127.0.0.1/32,::1/128`（仅为本机代理示例，按实际部署配置）。最多 32 个 CIDR，禁止默认路由。代理必须正确覆盖或追加 `X-Forwarded-For`，且禁止不受信任的进程通过受信来源伪造客户端地址。不设置时安全地记录 TCP 对端 IP。该项不会自动修改现有部署设置。

登录详情复用 `VIORKA_GEOIP_DATABASE` 的本地 MaxMind City 数据库，按查询时数据库解释地址；地理位置为近似值，数据库更新可能改变显示结果。没有数据库仍可正常登录和查看 IP 历史。
