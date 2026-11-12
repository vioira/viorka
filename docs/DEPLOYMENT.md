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

备份目录为 `<VIORKA_DATABASE>.backups`，目录 0700、文件 0600。系统设置的“备份” Tab 管理自动备份（默认关闭）、5 段 Cron（UTC，默认 `0 3 * * *`）、保留天数（默认 14）与最多保留份数（默认 0，不限份数）。0 关闭对应限制；两项限制独立生效，后台每分钟清理到期或超额记录，即使自动备份已关闭。停机错过的执行分钟不补跑；同一分钟已有计划记录（含失败记录）不重复执行。单快照明文上限 256 MiB，保存前验证完整性并加密。恢复计划中的文件不会被自动清理或手动删除。

默认只保存本地。可选 S3 为加密文件增加远端副本，本地文件继续用于下载和恢复。配置支持 HTTPS Endpoint（留空使用 AWS S3）、Region、Bucket、路径前缀、Access Key ID、Secret Access Key 与 Path-style。凭证必须有对应前缀的 PutObject/DeleteObject 权限；配置保存不代表连接测试成功，首次实际备份验证上传。Secret Access Key 加密保存，读取 API 不返回原值，更新时留空保留。上传失败记录为失败，不报告备份成功。记录保留原远端位置与加密凭证；同一 Endpoint/Region/Bucket 使用当前凭证删除旧对象，切换目的地则使用原凭证，不将新凭证发送到旧地址。删除远端失败时保留记录供重试。S3 开启版本控制或 Object Lock 时，DeleteObject 不保证永久清除历史版本，需另配 Bucket 生命周期策略。

记录包含 ID、状态、文件名、大小、过期时间、触发方式及开始时间，列表默认每页 50 条（最大 100）。下载内容是加密 `.backup` 文件，不包含解密密钥。迁移时须单独安全保存 `.backups/encryption.key`、记录文件和数据库旁 `.engine-key`；S3 不上传密钥。备份记录独立存储在私有备份目录，重启后中断中的记录标为失败。本次开发期 Schema 修改需使用新测试库，不自动迁移或重置已有数据库。

恢复流程：在“备份”中选中快照，输入当前密码并确认，界面显示等待重启；停止唯一的 Panel 进程后再启动。启动会验证快照，checkpoint 当前数据库，保留 `.before-restore-*` 副本后替换；使用备份中的账号重新登录，Agent 自动重新握手。恢复前可取消计划。恢复会关闭自动备份及 S3，并清空数据库中的 S3 密钥，需重新配置以免恢复旧凭证。校验失败时启动终止并保留原库与计划；检查磁盘权限、快照与密钥，必要时离线移走 `.backups/restore.json` 取消计划。恢复前副本可能含敏感数据，须另行加密归档。

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

未配置本地库且未启用在线兜底时不运行地区解析，未解析节点显示“地区未知”。显式配置了不存在、损坏或非 City 类型的数据库时，Panel 启动报错，不静默忽略配置。默认查询在本地进行，不向第三方提交节点 IP。IP 地区代表公网出口归属地，尤其对 NAT 节点不等于机房实际位置。

### 节点地区在线兜底

```sh
VIORKA_IPINFO_FALLBACK=true
# 可选；不配置时使用匿名请求
VIORKA_IPINFO_TOKEN=
```

`VIORKA_IPINFO_FALLBACK` 默认为 `false`，只接受 `true` / `false`；修改后重启 Panel 生效。启用后，本地查询缺少国家代码时，由 Panel 后台向 `https://ipinfo.io/<IP>/json` 提交节点公网 IP，使用返回的国家、省州和城市；本地已有国家时不补查城市。未配置本地库时可单独使用在线查询，显式配置的损坏数据库仍会阻止启动。本地查询报错沿用原有错误处理，不视为未命中。

这里使用的是 IPinfo Legacy `/json` 接口，Token 可选；IPinfo Lite `/lite/<IP>` 是另一接口，需要 Token，二者不能混用。Token 经 Authorization 请求头发送，不放入 URL。匿名请求和账号请求受 IPinfo 对应配额限制；HTTP 429、认证失败和响应异常按查询失败处理，不写入伪造地区。

在线请求超时为 3 秒，支持后台任务取消，不阻塞节点列表请求。沿用最多 4096 个 IP 的内存缓存，成功及空结果在缓存驻留期间不重复查询，失败最多尝试 3 次；重启或缓存清空后重新查询。登录来源仍只使用本地数据库，不调用 IPinfo。

### 通行密钥和登录来源

通行密钥要求浏览器安全上下文。使用与浏览器地址完全一致的 `VIORKA_ORIGIN=https://panel.example.com`，开发可用 `http://localhost`。WebAuthn 只接受该公开 Origin，额外 CORS 来源不会自动成为通行密钥来源。RP ID 是其主机名，改变域名后旧密钥不能用于新域名，应使用密码登录并重新注册。

反向代理后需要真实客户端 IP 时，显式设置 `VIORKA_TRUSTED_PROXIES=127.0.0.1/32,::1/128`（仅为本机代理示例，按实际部署配置）。最多 32 个 CIDR，禁止默认路由。代理必须正确覆盖或追加 `X-Forwarded-For`，且禁止不受信任的进程通过受信来源伪造客户端地址。不设置时安全地记录 TCP 对端 IP。该项不会自动修改现有部署设置。

登录详情复用 `VIORKA_GEOIP_DATABASE` 的本地 MaxMind City 数据库，按查询时数据库解释地址；地理位置为近似值，数据库更新可能改变显示结果。没有数据库仍可正常登录和查看 IP 历史。
