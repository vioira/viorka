# Panel 与 Agent 入门指南

## 当前交付

本轮完成本机可运行的基础闭环，**不等于 M0 已通过真实 NAT VPS 发布验收**。

- SQLite 驱动、WAL、每连接外键/锁等待、事务迁移、历史摘要检查、升级前快照及恢复测试。默认单 Panel 进程，数据库文件 0600。
- 用户名/密码登录（bcrypt）、HttpOnly/SameSite=Strict Cookie、HTTPS Secure、服务端角色授权、精确 Origin 和 CSRF 校验、注销及会话失效。支持多个设备同时登录，12 小时过期；保留登录历史、IP 变化、User-Agent、活动与结束记录。支持在安全设置中注册通行密钥，输入用户名后通过 WebAuthn 登录。
- 管理员创建/吊销 15 分钟单次绑定令牌；Agent 本地生成 Ed25519 身份。相同令牌和公钥在有效期内重试返回原节点，恢复丢失的注册响应；不同公钥不能复用令牌。
- 60 秒一次性挑战，签名原文绑定 Panel Origin、节点、nonce 和到期时间。校验失败也消费挑战。Agent 会话 15 分钟，服务端每秒检查吊销，WebSocket 到期关闭。
- Agent 主动出站 WSS，TLS CA/hostname 验证、hello 能力协商、30 秒心跳、默认 60 秒心跳超时窗口（系统设置可动态调整为 60–3600 秒，断线同样等待心跳超时）、1–30 秒指数退避加最多 50% 抖动。吊销和证书校验失败停止重连，不能自动重新注册。
- 持久化 `node.inspect` 任务：读取实际 OS/架构/hostname，无 Shell 或引擎变更。节点范围幂等键、单节点串行、30 秒租约、最多 3 次投递、5 分钟总截止时间、attempt 校验、终态不回退。只有这项无副作用任务允许自动重投。
- Agent 日志持久化成功后才回报结果；最多 1000 条、4 MiB，超过截止时间 24 小时后可清理。相同幂等键必须对应同一 task/deadline，重投返回已保存结果。
- Web 使用 Arc 的 Button、Input、PasswordField、RadioGroup、Alert、ConfirmMorph、Skeleton、EmptyState，接真实 API。SSE 在业务状态提交成功后发送无敏感内容的变更通知，浏览器合并节点状态或重新读取授权资源；会话失效或服务关闭时退出。支持游标分页。
- 身份/令牌吊销、注册令牌和任务创建记录管理审计；本轮没有审计查询 UI、用户 CRUD 或细粒度多租户授权。M0 的 viewer/operator/admin 作用域都是当前安装实例，资源隔离扩展在 M5。

## 本机启动 Web 与 Panel

Go 直接托管 Web 与 Docker Compose 部署见 [部署手册](DEPLOYMENT.md)。下列命令用于前端热更新开发。

Go 1.26+，Node 22，pnpm。

```sh
cp .env.example .env
# 编辑 .env，使 VIORKA_ORIGIN 与 Vite 浏览器访问地址一致（默认 https://localhost:8143）
make run
# 另一个终端
cd web
pnpm install --frozen-lockfile
pnpm run dev
```

启动自动读取当前工作目录的 `.env`；可通过进程环境变量 `VIORKA_ENV_FILE=/absolute/path/panel.env` 指定其他文件。默认 `.env` 不存在时使用环境变量与默认值，显式指定的文件不存在或格式错误则启动失败。优先级：进程环境变量（包括显式空值）> 文件 > 默认值。文件支持 `KEY=value`、成对单/双引号、空行和整行 `#` 注释；值为字面量，不执行 Shell、不展开变量、不支持 `export` 或行尾注释。相对路径以进程工作目录为准。

默认 API `127.0.0.1:8080`、浏览器 Origin `http://127.0.0.1:5173`、SQLite `data/viorka.db`。`VIORKA_ADMIN_USERNAME` 未指定或为空时默认 `admin`。仅空用户表会初始化管理员：默认生成 32 字符密码（192 位随机熵），保存到数据库同目录的 `<数据库文件名>.initial-password-*` 文件，权限为 `0600`；启动日志仅显示用户名和文件路径，不输出密码。读取该文件登录，修改密码后删除初始密码文件。已有用户（包括停用账号）时跳过初始化，重启不会重置密码。

如需兼容已有部署，可设置 `VIORKA_ADMIN_PASSWORD_FILE`，使用权限为 `0600` 的普通文件提供初始密码。读取时去掉首尾空白（包括空格、制表符和换行），保留密码内部空格，去除后须为 12–72 字节。配置文件和密码文件不要提交 Git。此配置改动不会修复旧库迁移校验和不匹配；开发阶段如需新库，请在 `.env` 中设置新的 `VIORKA_DATABASE` 路径，保留旧数据库。

Web 静态文件独立构建，由 Go 从 `VIORKA_WEB_DIR`（默认 `web/dist`）直接托管；访问 `/` 和前端路由返回 Web 页面。本机 HTTP 仅用于浏览器开发；Agent 必须使用 HTTPS。跨站 Cookie 不可用，Web/API 应由同一公开 Origin 提供。

## PostgreSQL

默认保留 SQLite。使用 PostgreSQL 16+ 时，先创建专用数据库和数据库所有者，再配置：

```dotenv
VIORKA_DATABASE_DRIVER=postgres
VIORKA_DATABASE_URL=postgresql://viorka:password@db.example.com:5432/viorka?sslmode=verify-full
VIORKA_DATABASE=data/viorka-postgres
```

未指定 `sslmode` 时默认 `verify-full`。远程连接使用 `sslmode=verify-full`，私有 CA 可通过 URL 的 `sslrootcert` 参数指定；密码中的特殊字符按 URL 编码。本机隔离测试库可显式使用 `sslmode=disable`。应用按连接配置执行 TLS 校验，不自动降级连接配置。

启动会在目标数据库的默认 Schema 创建表、函数和触发器，需要对应 DDL 权限。连接 URL 含凭证，放在私有环境文件或服务密钥配置中。`VIORKA_DATABASE` 继续定位本地 `.engine-key`、初始密码文件和 `.backups` 目录，PostgreSQL 数据存储在远端数据库。每个数据库使用独立的本地路径前缀，部署时持久化该目录。

系统设置中的手动备份、自动备份、S3 副本及重启恢复同时支持两种数据库。PostgreSQL 备份导出一致性逻辑快照；恢复在事务中导入并保留恢复前副本。恢复仍须停止唯一 Panel 后再启动。

## HTTPS 与 Agent

配置 `VIORKA_ORIGIN=https://panel.example.com` 为浏览器与 Agent 共用的公开 Origin，不带路径或末尾斜线。可以通过受控 TLS 反向代理连接本机 API；也可指定 `VIORKA_TLS_CERT` 和 `VIORKA_TLS_KEY` 直接终止 TLS。非 loopback 监听要求这两项 TLS 配置且 Origin 为 HTTPS，不会根据外部 `X-Forwarded-*` 放宽限制。

在 Web 登录，进入节点页点击“添加节点”，填写名称和类型后生成令牌；此时待注册节点已保存。Agent 仓库中准备配置：

```json
{
  "panel_url": "https://panel.example.com",
  "node_name": "nat-node",
  "state_dir": "/absolute/private/viorka-agent",
  "log_level": "info",
  "ca_file": "/absolute/path/private-ca.pem"
}
```

公信 CA 时省略 `ca_file`；私有 CA 仅添加信任，仍验证 hostname。节点显示名称和类型由管理员创建令牌时指定，`node_name` 为本地启动标签。状态目录必须 0700，身份/任务日志 0600，目录有进程锁；不要把同一身份复制到多个节点。

```sh
cd ../viorka-agent
go build -o /tmp/viorka-agent ./cmd/viorka-agent
/tmp/viorka-agent config-check --config /absolute/path/agent.json
/tmp/viorka-agent register --config /absolute/path/agent.json --token-stdin
# 通过安全标准输入提供令牌，然后结束输入；也可从受限权限文件重定向。
/tmp/viorka-agent run --config /absolute/path/agent.json
```

注册响应丢失时可在令牌有效期内以相同状态目录重试。到期后未持有 node_id 的身份需要管理员吊销旧绑定并显式重新配置，Agent 不会静默覆盖身份。吊销节点只关闭管理身份，不卸载 Agent、不停止其他进程。`doctor` 明确显示连接未检查。

## 协议与兼容

权威源 `api/agent/v1/envelope.schema.json`。生成类型保留旧 `proxy.apply` 示例的结构兼容，**这不授予执行权限**。本轮只接受 hello、heartbeat 和 node.inspect 的 dispatch/ack/result；未知消息关闭连接。M0 task 必须有 attempt 和匹配的资源、关联 ID，不能携带 revision。

```sh
python3 scripts/generate_protocol.py
python3 scripts/generate_protocol.py --check
python3 scripts/generate_protocol.py --output ../viorka-agent/protocol/v1/models.gen.go
```

Agent 同步时同时复制 Schema 快照和生成器，Agent CI 用 `--schema protocol/v1/envelope.schema.json --check` 独立校验。生成文件标注规范 SHA-256；构建不联网抓取协议。首次发布前仍须将两仓库提交固定到 release tag，不能把当前工作区当作已发布协议制品。

签名的确定性 UTF-8 编码（LF 分隔、末尾无 LF）：

```text
viorka-agent-session-v1
<configured public origin>
<node_id>
<challenge_id>
<expires_at in UTC RFC3339Nano>
```

WebSocket 限制：64 KiB 帧、JSON 深度 16、收件队列 8、每方向每分钟 120 条消息、最多 1024 节点连接；单写循环，写入超时 5 秒。队列满会断开连接，持久任务后续重投，不静默确认成功。认证入口按路由和可信来源 IP 独立计数，普通入口每分钟 60 次，Agent 入口每分钟 600 次，密码校验最多 4 个并发。

SSE 最多 128 连接、写入超时 5 秒，每次通知重新校验登录。无持久事件 replay，断线后以 REST 快照恢复；事件不携带凭证、完整配置或跨资源数据。

## 验证与限制

```sh
python3 -m venv /tmp/viorka-validation
/tmp/viorka-validation/bin/pip install -r scripts/requirements-dev.txt
PATH=/tmp/viorka-validation/bin:$PATH ./scripts/validate.sh
go test -race ./...
cd web && pnpm run typecheck && pnpm run build
# 从 Panel 仓库，启动两个真实临时进程和测试证书
python3 scripts/e2e_agent_connection.py --agent ../viorka-agent
```

已编写可重复验证：真实 SQLite 升级/回滚/约束/备份恢复，HTTP RBAC/CSRF/错误路径，challenge 重放、注册原子消费、TLS 信任失败、跨节点伪造、任务去重/租约/attempt/终态保护、SSE 注销，以及双进程注册、Panel crash/restart、Agent restart、吊销和独立进程存活。

仍须验收：真实 NAT VPS 的出站网络和反向代理、Debian/Alpine 的运行行为及长期资源基线、高连接数压测、公开发行固定版本和制品签名。Linux 交叉编译不能替代实机验收。无引擎适配、配置发布、真实代理连续性测试或任意远程 Shell。

Compose 已提供前后端镜像构建、Go 原生 TLS 与持久化数据卷，配置见 [部署手册](DEPLOYMENT.md)。systemd 示例需按实际路径和权限配置。数据库只允许单个 Panel 进程访问；升级前应保留备份，恢复时先停止 Panel，再将已验证快照替换为数据库文件（0600），不要覆盖仍运行的 WAL 数据库。

## Arc 适配说明

官方组件通过 `pnpm exec shadcn add @uiarc/...` 安装，无新增组件库和依赖。React 18 的 `inert` 使用空字符串属性并补充类型；EmptyState 去除装饰底板。其余只格式化和保留官方动画语义的局部 lint 注释，没有替换交互内核。

浏览器已验证真实登录、注册令牌反馈、SSE 状态、确认焦点及 390/768/1024/1440 断点。深色 token 已按 Radix Gray 分别定义并检查 CSS；本机浏览器为浅色，深色实际渲染与屏幕阅读器验收尚待补齐。

Arc review：组件选择与 API、文案、语义 token、加载/空/错误/成功/禁用状态、键盘确认、移动端溢出已核查。深色实机渲染和屏幕阅读器为待验收项；不会据 CSS 检查宣称已完成实测。

## API 文档

后端启动后访问 `http://127.0.0.1:8080/docs`。可下载 `/openapi.json` 或 `/openapi.yaml` 导入 API 客户端。仓库中的 `api/openapi/openapi.yaml` 由 `make generate-openapi` 自动生成，具体维护方式见 [DEVELOPMENT.md](DEVELOPMENT.md#api-文档生成)。

## 主机监控

Linux Agent 使用 `node.telemetry.v3` 上报主机指标，默认通过 HTTP，页面订阅时按需使用 WSS。列表、概览和详情均读取新版快照；缺失或过期显示未知，实时保留 10 分钟原始点，历史使用持久化 30 秒桶。旧监控协议和设置已移除，双方需配套升级。配置与验收边界见 [MONITORING.md](MONITORING.md)。

## 批量自动注册与节点改名

节点页管理员可通过“批量注册”创建一枚共享注册令牌，无需预建节点。有效期为 1–720 小时，最多注册 1–10000 个新节点；Web 默认 24 小时、50 个节点。未过期且未撤销的令牌可由管理员再次查看和复制，列表展示使用次数、有效期和撤销状态，可查看该批次注册的节点。注册后先显示离线，真实 WSS 连接建立后才显示在线。

单节点首次注册时，在“添加节点”完成后复制安装命令，到对应服务器执行。为已有节点重新注册时，使用该节点弹层生成的命令，其中的 `--reenroll-node=ID` 指定原节点。两种命令都会先下载安装脚本，再通过 `--token-stdin` 提供一次性令牌。

安装命令默认直连 GitHub。目标服务器访问 GitHub 较慢时，在弹层的“GitHub 下载代理”选择预设镜像或输入自定义 HTTPS 前缀，再复制命令。安装脚本和 Agent 发布文件都会通过所选代理下载，请使用信任的代理。注册和运行时连接仍直连面板。

在批量令牌弹层点击“复制安装命令”，在每台新服务器直接执行即可注册。命令包含共享令牌，可能保存在剪贴板和终端历史中。批量安装命令同样使用 `--token-stdin`，并传入 `--registration`。安装器随后调用 Agent 的 `register --token-stdin`；非交互部署先取得并核对安装脚本，再使用：

```sh
# /run/secrets/viorka-registration-token 是部署工具提供的受限凭证文件。
sh install.sh install --url=https://panel.example.com --registration --token-stdin \
  < /run/secrets/viorka-registration-token
```

已有本地配置和匹配版本二进制时，可直接注册：

```sh
viorka-agent register --config /absolute/path/agent.json --token-stdin --name hk-01 \
  < /run/secrets/viorka-registration-token
viorka-agent run --config /absolute/path/agent.json
```

省略 `--name` 时，Panel 使用令牌前缀加 Agent 主机名，超长自动名称按 UTF-8 边界截到 128 字节；无主机名时用节点短 ID。显式名称最多 128 字节，覆盖前缀。节点类型以令牌配置为准；主机名和 IP 不用作身份去重。不要把已生成的 Agent 身份打进服务器镜像。

注册失败后保留原状态目录并使用同一令牌重试；同一令牌和公钥不会重复创建节点或扣配额，即使配额已满也允许有效令牌下的原绑定重试。过期、撤销、身份吊销或节点删除后拒绝恢复。若 Panel 已创建节点但客户端未保存结果且令牌已失效，管理员需核对记录并走显式身份恢复流程，不能通过删除身份文件不断重建节点。

批量令牌只用于新节点，可同时恢复本机的 Viorka 托管引擎。若引擎仍归属其他节点，注册返回 409 且不消耗配额。“添加节点”生成的单节点令牌同样使用 `register`，Panel 自动识别令牌类型；旧节点换钥使用 `register --replace-node`，单节点注册保留托管引擎恢复。撤销批量令牌不影响已注册节点；删除节点不返还已使用配额。

节点详情“设置”中的“修改名称”允许管理员更新显示名称，离线、待注册、在线和禁用节点均可修改。只改变 Panel 名称，不改服务器 hostname、节点 ID、身份、历史记录或代理配置；并发修改返回冲突，刷新后重新编辑。

发布要求：批量入口需要本次 Panel/Web 代码，以及支持 `register` 的 Agent 二进制和支持 `--registration` 的安装脚本。尚未发布的新功能不能用旧发布制品验收；旧 Agent 的单节点注册和已注册连接仍可使用。

本地双进程验证命令（使用测试自建 TLS CA、临时数据库及独立 Agent 状态目录）：

```sh
(cd ../viorka-agent && go build -o /tmp/viorka-batch-test-agent ./cmd/viorka-agent)
VIORKA_TEST_AGENT_BINARY=/tmp/viorka-batch-test-agent \
  go test ./internal/httpapi -run '^TestRegistrationAgentProcess$' -count=1 -v
```

此测试验证两次批量注册、一次单节点注册及各自的真实 WSS 连接，不代表 Linux 服务管理、真实 VPS 部署或长稳验收。
