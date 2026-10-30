# Panel 与 Agent 入门指南

## 当前交付

本轮完成本机可运行的基础闭环，**不等于 M0 已通过真实 NAT VPS 发布验收**。

- SQLite 驱动、WAL、每连接外键/锁等待、事务迁移、历史摘要检查、升级前快照及恢复测试。默认单 Panel 进程，数据库文件 0600。
- 用户名/密码登录（bcrypt）、HttpOnly/SameSite=Strict Cookie、HTTPS Secure、服务端角色授权、精确 Origin 和 CSRF 校验、注销及会话失效。每用户仅一个活动会话，12 小时过期。
- 管理员创建/吊销 15 分钟单次绑定令牌；Agent 本地生成 Ed25519 身份。相同令牌和公钥在有效期内重试返回原节点，恢复丢失的注册响应；不同公钥不能复用令牌。
- 60 秒一次性挑战，签名原文绑定 Panel Origin、节点、nonce 和到期时间。校验失败也消费挑战。Agent 会话 15 分钟，服务端每秒检查吊销，WebSocket 到期关闭。
- Agent 主动出站 WSS，TLS CA/hostname 验证、hello 能力协商、30 秒心跳、90 秒离线窗口、1–30 秒指数退避加最多 50% 抖动。吊销和证书校验失败停止重连，不能自动重新注册。
- 持久化 `node.inspect` 任务：读取实际 OS/架构/hostname，无 Shell 或引擎变更。节点范围幂等键、单节点串行、30 秒租约、最多 3 次投递、5 分钟总截止时间、attempt 校验、终态不回退。只有这项无副作用任务允许自动重投。
- Agent 日志持久化成功后才回报结果；最多 1000 条、4 MiB，超过截止时间 24 小时后可清理。相同幂等键必须对应同一 task/deadline，重投返回已保存结果。
- Web 使用 Arc 的 Button、Input、PasswordField、RadioGroup、Alert、ConfirmMorph、Skeleton、EmptyState，接真实 API。SSE 每 3 秒发送无敏感内容的失效通知，浏览器重新读取授权资源；会话失效或服务关闭时退出。支持游标分页。
- 身份/令牌吊销、注册令牌和任务创建记录管理审计；本轮没有审计查询 UI、用户 CRUD 或细粒度多租户授权。M0 的 viewer/operator/admin 作用域都是当前安装实例，资源隔离扩展在 M5。

## 本机启动 Web 与 Panel

Go 1.26+，Node 22，pnpm。

```sh
cp .env.example .env
# 编辑 .env，使 VIORKA_ORIGIN 与浏览器访问地址一致
make run
# 另一个终端
cd web
pnpm install --frozen-lockfile
pnpm run dev
```

启动自动读取当前工作目录的 `.env`；可通过进程环境变量 `VIORKA_ENV_FILE=/absolute/path/panel.env` 指定其他文件。默认 `.env` 不存在时使用环境变量与默认值，显式指定的文件不存在或格式错误则启动失败。优先级：进程环境变量（包括显式空值）> 文件 > 默认值。文件支持 `KEY=value`、成对单/双引号、空行和整行 `#` 注释；值为字面量，不执行 Shell、不展开变量、不支持 `export` 或行尾注释。相对路径以进程工作目录为准。

默认 API `127.0.0.1:8080`、浏览器 Origin `http://127.0.0.1:5173`、SQLite `data/viorka.db`。`VIORKA_ADMIN_USERNAME` 未指定或为空时默认 `admin`。仅空用户表会初始化管理员：默认生成 32 字符密码（192 位随机熵），保存到数据库同目录的 `<数据库文件名>.initial-password-*` 文件，权限为 `0600`；启动日志仅显示用户名和文件路径，不输出密码。读取该文件登录，修改密码后删除初始密码文件。已有用户（包括停用账号）时跳过初始化，重启不会重置密码。

如需兼容已有部署，可设置 `VIORKA_ADMIN_PASSWORD_FILE`，使用权限为 `0600` 的普通文件提供 12–72 字节初始密码（允许末尾一个换行）。配置文件和密码文件不要提交 Git。此配置改动不会修复旧库迁移校验和不匹配；开发阶段如需新库，请在 `.env` 中设置新的 `VIORKA_DATABASE` 路径，保留旧数据库。

Web 静态文件仍独立构建和托管，Go 不内嵌 `web/dist`。本机 HTTP 仅用于浏览器开发；Agent 必须使用 HTTPS。跨站 Cookie 不可用，Web/API 应由同一公开 Origin 提供。

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
/tmp/viorka-agent enroll --config /absolute/path/agent.json --token-stdin
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

WebSocket 限制：64 KiB 帧、JSON 深度 16、收件队列 8、每方向每分钟 120 条消息、最多 1024 节点连接；单写循环，写入超时 5 秒。队列满会断开连接，持久任务后续重投，不静默确认成功。认证入口共用每分钟 60 次全局预算（单实例初始配置，批量节点接入需评估），密码校验最多 4 个并发。

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

现有 Compose/systemd 示例仍来自脚手架，本轮未改变部署配置；其只读容器缺少 SQLite 卷，不能直接用作 M0 部署。数据库只允许单个 Panel 进程访问；升级前应保留备份，恢复时先停止 Panel，再将已验证快照替换为数据库文件（0600），不要覆盖仍运行的 WAL 数据库。

## Arc 适配说明

官方组件通过 `pnpm exec shadcn add @uiarc/...` 安装，无新增组件库和依赖。React 18 的 `inert` 使用空字符串属性并补充类型；密码显示按钮扩大到 44px；EmptyState 去除装饰底板。其余只格式化和保留官方动画语义的局部 lint 注释，没有替换交互内核。

浏览器已验证真实登录、注册令牌反馈、SSE 状态、确认焦点及 390/768/1024/1440 断点。深色 token 已按 Radix Gray 分别定义并检查 CSS；本机浏览器为浅色，深色实际渲染与屏幕阅读器验收尚待补齐。

Arc review：组件选择与 API、文案、语义 token、加载/空/错误/成功/禁用状态、键盘确认、移动端溢出与 44px 触摸目标已核查。深色实机渲染和屏幕阅读器为待验收项；不会据 CSS 检查宣称已完成实测。

## API 文档

后端启动后访问 `http://127.0.0.1:8080/docs`。可下载 `/openapi.json` 或 `/openapi.yaml` 导入 API 客户端。仓库中的 `api/openapi/openapi.yaml` 由 `make generate-openapi` 自动生成，具体维护方式见 [DEVELOPMENT.md](DEVELOPMENT.md#api-文档生成)。

## 主机监控

支持 `node.metrics.v1` 的 Linux Agent 现在可上报 CPU、内存/Swap、负载、根文件系统容量、运行时长及逐网卡收发计数和速率。节点列表与详情使用真实监控 API，缺失/过期显示未知；最近一小时趋势为有界内存缓存，重启后重新积累。配置、兼容矩阵、资源上限与验收边界见 [MONITORING.md](MONITORING.md)。
