# 开发与部署手册

Go 服务直接提供 Web 页面、REST、SSE 和 WebSocket，共用一个端口，无需 Nginx。镜像构建时编译前后端，运行时由 Go 读取镜像中的 `web/dist`；静态文件不嵌入 Go 二进制。

## Docker Compose 部署

在仓库根目录创建 `deploy/.env`：

```dotenv
VIORKA_ORIGIN=https://panel.example.com
VIORKA_BIND_IP=0.0.0.0
VIORKA_PORT=443
VIORKA_TLS_DIR=/absolute/path/to/tls
```

证书目录须包含 `fullchain.pem` 和 `privkey.pem`，证书匹配公开域名。容器以 UID/GID `0:0` 运行，Compose 移除了 Linux capabilities。证书目录和私钥可由 root 持有，目录权限设为 `0700`，私钥设为 `0600`。证书目录只读挂载。`VIORKA_ORIGIN` 必须与浏览器地址完全一致；使用非 443 端口时加上端口号。

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=100 viorka-server
```

访问 `https://panel.example.com/` 即可打开 Web，刷新 `/nodes/...` 等前端路由也会返回页面。API、`/healthz`、`/readyz` 和 `/docs` 保持原入口。Go 直接处理 TLS，Agent 使用同一公开地址连接 HTTPS/WSS。

Compose 默认绑定宿主机 `127.0.0.1:8443`；上述配置显式开放 `443`。容器内监听 `8080`，仍使用 HTTPS。沿用旧卷或绑定目录时，请确认 UID 0 按文件权限可写入数据目录及已有数据库，并可读取密钥。命名卷 `viorka-data` 保存数据库、引擎密钥、初始密码和备份，容器根文件系统只读。单实例运行，停止宽限期为 30 秒。

首次启动管理员用户名为 `admin`，日志给出初始密码文件路径。镜像无 Shell，可将日志中的具体文件复制到本机读取：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml cp viorka-server:/app/data/viorka.db.initial-password-实际后缀 ./initial-password
chmod 600 ./initial-password
cat ./initial-password
```

也可使用 GitHub Actions 发布的镜像：在 `deploy/.env` 中设置 `VIORKA_IMAGE=ghcr.io/vioira/viorka:v实际版本`，然后执行：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --no-build --pull always
```

未设置 `VIORKA_IMAGE` 时默认使用 `ghcr.io/vioira/viorka:latest`，该标签仅由正式版本更新；预发布须显式指定版本标签。镜像包含 amd64 和 arm64 两种架构，由 Docker 自动选择。

更新代码后重新执行 `up -d --build`。重建容器保留命名卷；`down -v` 会删除卷中的数据库、密钥和备份。证书更新后须重启服务加载。

### 宿主机 Nginx 通过 Docker bridge 回源

项目 Compose 为默认 bridge 固定了 IPv4 子网和网关。宿主机 Nginx 通过发布到回环地址的端口回源时，可在 `deploy/.env` 中配置以下值。先确认子网与宿主机路由和其他 Docker 网络无重叠，端口与 Nginx 实际 HTTPS 上游一致。

```dotenv
VIORKA_BIND_IP=127.0.0.1
VIORKA_PORT=8443
VIORKA_BRIDGE_SUBNET=172.30.240.0/24
VIORKA_BRIDGE_GATEWAY=172.30.240.1
VIORKA_TRUSTED_PROXIES=${VIORKA_BRIDGE_GATEWAY}/32
```

仅当通过网关访问面板的进程都可信时启用上述受信代理。Nginx 在校验 Cloudflare 回源地址并还原访客 IP 后，用 `proxy_set_header X-Forwarded-For $remote_addr;` 覆盖转发头。首次切换网络时，使用原 Compose 项目名执行 `down` 和 `up -d`，期间面板会短暂停机。普通 `down` 保留命名卷，后续重建网络会复用配置中的网关。

如果需要由宿主机 Nginx 终止 TLS 并通过 HTTP 回源，可在自定义 Compose 服务中配置以下字段：

```yaml
environment:
  VIORKA_LISTEN: "0.0.0.0:8080"
  VIORKA_ORIGIN: "https://panel.example.com"
  VIORKA_PROXY_TERMINATES_TLS: "true"
ports:
  - "127.0.0.1:6668:8080"
```

移除容器的 TLS 环境变量和证书挂载，保留原有数据卷。Nginx 使用 `proxy_pass http://127.0.0.1:6668;`，透传 Host 和 WebSocket Upgrade，关闭 SSE 缓冲。已有数据库的公开 Origin 也须为 HTTPS。仅将受信任的容器加入该 bridge，同网络容器可以直接访问明文端口。

## 本机直接运行

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
make build
VIORKA_ORIGIN=http://127.0.0.1:8080 ./bin/viorka-server
```

在仓库根目录运行后访问 `http://127.0.0.1:8080/`。`VIORKA_WEB_DIR` 默认为工作目录下的 `web/dist`，从其他目录启动时指定绝对路径。发布的 Go 二进制需配套 Web 构建产物；未构建 Web 时页面请求返回 503，API 继续服务。已有数据库以保存的公开 Origin 为准，在系统设置中保存后立即生效。

## 启动配置

复制根目录 `.env.example` 为 `.env` 后配置启动参数；系统环境变量优先，也可用 `VIORKA_ENV_FILE` 指定文件。用户名默认为 `admin`，空库首次启动自动生成密码并写入数据库同目录的 `0600` 私有文件，日志仅显示路径。已有用户不重置；完整格式和密码读取方式见 [GETTING_STARTED.md](GETTING_STARTED.md)。

## 接入边界

- 默认 Panel 监听 127.0.0.1:8080，数据库 data/viorka.db，默认公开 Origin 为 http://127.0.0.1:8080。
- 建议 Web、REST、SSE 和 Agent HTTPS/WSS 使用同一生产 Origin；公开 Origin 不带路径。额外浏览器来源使用下述白名单。
- 反向代理需透传 WebSocket Upgrade/Authorization、关闭 SSE 缓冲；不得记录令牌、Cookie 或请求体。
- Agent 仅需出站 TCP/TLS，不要求入站管理端口或 UDP。
- SQLite 和 PostgreSQL 均按单 Panel 进程运行。PostgreSQL 配置见 [启动说明](GETTING_STARTED.md#postgresql)，本地密钥及备份目录仍须持久化。
- `/readyz` 实际 Ping 当前配置的数据库。

## 设置与备份恢复

启动时首次以 `VIORKA_ORIGIN` 初始化持久化设置，之后以已保存的公开 Origin 为准。公开 Origin 保存成功后立即生效，新的 Agent challenge、安装命令和浏览器来源校验使用新地址。切换前先准备新地址的证书和反向代理，切换后从新地址登录。支持 `panel.origin.v1` 的 Agent 自动迁移。已连接的节点收到切换通知后重新握手，离线节点从上次可信地址重连时获取当前目标。旧域名、TLS 证书和 Agent API 回源应保留至所有节点确认；不要将旧地址配置为跨域 HTTP 重定向。节点列表和详情展示“等待新地址确认”“已连接新地址”或“地址迁移需升级 Agent”。旧 Agent 升级后可使用原身份继续迁移。

备份目录为 `<VIORKA_DATABASE>.backups`，目录 0700、文件 0600。系统设置的“备份” Tab 管理自动备份（默认关闭）、5 段 Cron（UTC，默认 `0 3 * * *`）、保留天数（默认 14）与最多保留份数（默认 0，不限份数）。0 关闭对应限制；两项限制独立生效，后台每分钟清理到期或超额记录，即使自动备份已关闭。停机错过的执行分钟不补跑；同一分钟已有计划记录（含失败记录）不重复执行。单快照明文上限 256 MiB，保存前验证完整性并加密。恢复计划中的文件不会被自动清理或手动删除。

默认只保存本地。可选 S3 为加密文件增加远端副本，本地文件继续用于下载和恢复。配置支持 HTTPS Endpoint（留空使用 AWS S3）、Region、Bucket、路径前缀、Access Key ID、Secret Access Key 与 Path-style。凭证必须有对应前缀的 PutObject/DeleteObject 权限；配置保存不代表连接测试成功，首次实际备份验证上传。Secret Access Key 加密保存，读取 API 不返回原值，更新时留空保留。上传失败记录为失败，不报告备份成功。记录保留原远端位置与加密凭证；同一 Endpoint/Region/Bucket 使用当前凭证删除旧对象，切换目的地则使用原凭证，不将新凭证发送到旧地址。删除远端失败时保留记录供重试。S3 开启版本控制或 Object Lock 时，DeleteObject 不保证永久清除历史版本，需另配 Bucket 生命周期策略。

记录包含 ID、状态、文件名、大小、过期时间、触发方式及开始时间，列表默认每页 50 条（最大 100）。下载内容是加密 `.backup` 文件，不包含解密密钥。迁移时须单独安全保存 `.backups/encryption.key`、记录文件和数据库旁 `.engine-key`；S3 不上传密钥。备份记录独立存储在私有备份目录，重启后中断中的记录标为失败。本次开发期 Schema 修改需使用新测试库，不自动迁移或重置已有数据库。

恢复流程：在“备份”中选中快照，输入当前密码并确认，界面显示等待重启；停止唯一的 Panel 进程后再启动。启动会验证快照并保留 `.before-restore-*` 副本；SQLite checkpoint 后替换文件，PostgreSQL 在单一事务内导入业务表；使用备份中的账号重新登录，Agent 自动重新握手。恢复前可取消计划。恢复会关闭自动备份及 S3，并清空数据库中的 S3 密钥，需重新配置以免恢复旧凭证。校验失败时启动终止并保留原库与计划；检查磁盘权限、快照与密钥，必要时离线移走 `.backups/restore.json` 取消计划。恢复前副本可能含敏感数据，须另行加密归档。

## 多个浏览器请求来源

可在 `.env` 或进程环境中配置额外可信来源，重启生效：

```dotenv
VIORKA_ALLOWED_ORIGINS=https://console.example.com,https://admin.example.com
```

当前生效的公开 Origin 始终允许，额外列表不改变 Agent 签名绑定、安装地址或设置中的 `active_origin`。列表独立于数据库设置，留空保持单来源；最多 32 项，去除项首尾空白并去重。每项必须是精确 HTTP(S) Origin，不带路径、末尾斜线、用户信息、查询或 fragment，不支持通配符；HTTP 仅允许 localhost/loopback。无效配置拒绝启动。

订阅路径 `/api/v1/subscription-links/` 后包含 bearer 凭证，反向代理和其他接入日志须对完整路径及查询禁用记录或脱敏；不要把订阅链接放入普通访问日志。订阅恢复流程和客户端兼容性限制见 [客户端订阅](SUBSCRIPTIONS.md)。

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

通行密钥要求浏览器安全上下文。将面板的公开 Origin 设置为与浏览器地址完全一致的地址，例如 `https://panel.example.com`，开发可用 `http://localhost`。WebAuthn 只接受该公开 Origin，额外 CORS 来源不会自动成为通行密钥来源。RP ID 是其主机名，改变域名后旧密钥不能用于新域名，应使用密码登录并重新注册。

反向代理后需要真实客户端 IP 时，显式设置 `VIORKA_TRUSTED_PROXIES=127.0.0.1/32,::1/128`（仅为本机代理示例，按实际部署配置）。最多 32 个 CIDR，禁止默认路由。代理必须正确覆盖或追加 `X-Forwarded-For`，且禁止不受信任的进程通过受信来源伪造客户端地址。不设置时安全地记录 TCP 对端 IP。该项不会自动修改现有部署设置。

登录详情复用 `VIORKA_GEOIP_DATABASE` 的本地 MaxMind City 数据库，按查询时数据库解释地址；地理位置为近似值，数据库更新可能改变显示结果。没有数据库仍可正常登录和查看 IP 历史。

托管中转线路的上线验收和数据库回退顺序见[线路验收与回退](NAT_AND_RELAY.md#验收与回退)。

### 中转线路公网探测点

Panel 对每条已应用并运行的中转线路自动检测一次客户端公网 TCP 入口。选择一个能代表客户端外网视角的出站位置。

| 部署网络 | 环境配置 |
| --- | --- |
| Panel 可以从外网访问入口 | 设置 `VIORKA_RELAY_PROBE_SOURCE=panel`。 |
| Panel 与入口共用内网、共享 NAT，或无法确定两者网络关系 | 将 `VIORKA_RELAY_PROBE_SOURCE` 设置为已获授权、位于外网的 HTTPS CONNECT 代理源站，如 `https://probe.example.net:8443`。在 `VIORKA_RELAY_PROBE_AUTH_FILE` 指定仅 Panel 可读的文件，内容为一行 `Basic <base64(user:password)>` 或 `Bearer <token>`。 |

留空时显示“探测点不可用”。全局设置适用于本 Panel 的线路，修改后重启 Panel。此前失败或缺少探测点的线路可以点击“重新检测”。使用 Panel 本机时，检查会拒绝与已知入口地址处于同一接口网段的目标；共享 NAT 和不同网络使用相同地址段的情况需要部署者核实。

外部探测点必须验证 Panel 的凭证，仅在已成功连至给定 IP 和端口后响应 CONNECT 2xx。该代理应限制允许连接的入口及端口。Panel 验证探测点的 TLS 证书，用系统 DNS 解析客户端域名、检查全部返回地址，然后只向探测点发送已核准的数字 IP 和端口。两端 DNS 视图不同时，Panel 侧也须能解析到授权公网地址。每个 Panel 同时运行一个任务，总时限 12 秒，单次连接最多 2.5 秒，最多两轮，每轮至多尝试四个已核准地址。TCP 连接建立后立即关闭。

直连 VPS 同端口可以使用节点上报的公网 IP。共享或转换端口优先核对该节点已分配的 TCP 公私端口和监听地址。对于手工填写的 NAT 端口，实例管理员发布时可以授权探测节点上报 IP 上的指定端口，已有分配记录优先，失效记录也会阻止沿用手工授权。域名解析出的每个地址都须属于已授权地址，或来自独立分配记录中登记的该端口域名。仅有线路草稿或缺少地址归属的任意公网 IP 都不足以发起探测。
