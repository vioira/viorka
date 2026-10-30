# 开发约定与模块依赖

## 开发先决条件

- Go 1.26+（此脚手架的编译基线，不代表要求使用最新 Go）。
- Node.js 22.12+ + pnpm（Vite 8 的 Node.js 22 最低要求为 22.12；Web 预览需要下载 React/Vite 依赖）。
- Python 3（用于简单 JSON/协议文件检查；代码生成器位于 scripts/generate_protocol.py）。
- SQLite CLI（可选：检查 schema，无需进入运行时）。

## 工作流

```bash
cd viorka
./scripts/validate.sh
# Web
cd web
pnpm install --frozen-lockfile
pnpm run build
```

先安装 `scripts/requirements-dev.txt`。`./scripts/validate.sh` 验证 Go 格式、测试/vet/构建、Schema、OpenAPI 引用和生成类型漂移；双进程和 race 测试另外执行，见 [GETTING_STARTED.md](GETTING_STARTED.md)。

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
- REST 端点在 `internal/httpapi` 中统一注册路由、输入/输出类型、权限和错误码；Schema 由 Huma 从 Go 类型生成。修改后运行 `make generate-openapi` 并补契约测试，不手工编辑生成的 YAML。

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

## API 文档生成

- 默认本地文档页面：`http://127.0.0.1:8080/docs`。
- `/openapi.json` 与 `/openapi.yaml` 返回与当前运行代码一致的 OpenAPI 3.1 文档；这些文档端点公开且不包含运行数据或凭证。
- `/docs` 使用固定版本 ReDoc，浏览器需要访问 `cdn.redoc.ly` 加载文档渲染器；离线时可下载 `/openapi.yaml` 用本地工具阅读。页面只用于阅读，不提供认证或执行请求功能。
- `make generate-openapi` 从同一套路由注册和 Go 类型生成 `api/openapi/openapi.yaml`，无需数据库、管理员凭证或运行中的服务。
- `make check-openapi` 检查生成产物是否过期；CI 和 `scripts/validate.sh` 均执行该检查。
- Huma 固定为 v2.40.0（要求 Go 1.26+），仅使用 OpenAPI/Schema 层。现有处理器继续负责严格 JSON 解码、大小限制、Origin/CSRF、鉴权及错误响应，不引入 Huma 默认的 422 或 Problem Details 行为。
- 类型和路径自动生成；业务说明、字节长度、角色、错误状态码、响应头、流式协议语义仍须随实现维护。自动生成不等于证明 HTTP 行为正确，需保留 handler 测试。
- SSE/WSS 仅描述 HTTP 流或升级握手；Agent 消息的权威 Schema 仍在 `api/agent/v1`。

## 概览页面演示数据

- `web/src/views/home/mock-data.ts` 集中维护概览的节点、关注事项及三个时间范围的流量样例；页面明确标注演示数据，不请求运行指标接口。
- 注册令牌和添加节点入口尚未接入，在概览中禁用。流量范围、图例显示、节点展开和表头排序是本地交互，不写入服务端。
- `web/src/components/data-table/index.tsx` 是公共表格入口，基于 Arc `SortableDataTable`，统一加载、错误重试、空数据与横向滚动；业务页面传入类型化列定义和记录。排序仅针对传入记录，不能作为服务端全量排序。
- 后续接口接入应在 `web/src/api/` 增加请求与响应转换，替换页面数据来源，保留公共表格与业务列定义的边界。
- Arc `MetricCard` 本地新增可选 `decimals`，透传已有 `AnimatedCounter` 精度参数，避免流量与成功率被整数舍入。更新官方源码时需保留此适配。

## 节点与审计日志演示页面

- `/nodes` 使用会话鉴权的 `GET /api/v1/nodes`，按 50 条及独占 ID 游标分页读取；刷新重载首页，加载更多追加记录。搜索、筛选与排序只针对已读取节点。`/audit-logs` 仍使用演示快照。
- 节点列表与抽屉展示真实名称、类型、连接状态、系统、架构、Agent 版本和最后在线时间。抽屉使用最近一次列表读取的记录，当前无独立详情接口；指标、地址、引擎和修订尚未提供，不能由演示数据补齐。待连接、离线、禁用均不计为在线。管理员通过“添加节点”填写名称和类型，点击“生成令牌”后立即创建待注册节点并刷新列表；Agent 注册绑定同一节点，启动连接后才显示在线。共用弹框位于 `web/src/components/enrollment/EnrollmentDialogs.tsx`，关闭或到期清除明文。
- 审计支持用户/系统分类及列排序，默认按时间倒序。CSV 导出当前筛选的全部演示记录（不跟随表格排序），包含 UTF-8 BOM、CSV 转义与公式注入防护；界面按浏览器时区显示时间，导出使用 UTC。
- 使用公共 Arc 表格、Button、SegmentedControl，以及官方 CLI 导入的 SearchField。SearchField 本地调整了中文清除标签、44px 点击区域；SearchField 与 Input 新增可选 `hideLabel`（默认 false），仅视觉隐藏标签，保留无障碍名称。节点搜索启用隐藏。两者通过共享 `--input-*` token 采用原型的 1px 弱边框、13px 圆角及绿色聚焦外圈；升级官方组件时保留这些适配。
- 节点请求可取消，后发请求优先；失败保留已有列表与输入，通过全局 Toast 提示，使用刷新入口重试。首次失败显示尚未读取而非空数据成功。审计页仍为同步演示数据。

## 系统设置与用户角色页面

- `/settings` 包含通用、安全与备份，`tab=general|security` 支持直达、刷新及浏览器前进后退，未知值回退到通用；`/users` 独立为“用户与角色”侧边菜单。
- 通用设置由 SQLite 持久化，保存携带 revision，过期版本返回 409。面板名称和主题在保存后应用；公开 Origin 保存后于下一次启动生效，修改前有连接中断风险确认。重启前应同步配置证书、反向代理与 Agent 地址。服务端启动参数 Origin 仅用于首次初始化设置。
- SSE 开关控制新连接及活跃事件流；每 3 秒发送最多 100 条真实离线通知。离线通知由 Gateway 断线/心跳超时产生并去重，关闭告警不影响节点真实离线状态。通知列表也可手动刷新。
- 匿名遥测默认关闭。未配置接收服务时启用返回 `telemetry_unconfigured`，不外发任何数据。
- 注册令牌并入添加节点弹框，不再提供独立令牌列表。创建接口为 `POST /api/v1/nodes`，返回节点 ID、令牌和到期时间；`DELETE /api/v1/nodes/{id}/enrollment-token` 吊销该节点的注册令牌。关闭或到期清除明文，节点记录仍保留。创建超时不会自动重试，请先检查节点列表。
- 修改密码验证当前密码并使用 bcrypt，CAS 更新密码哈希与其他会话吊销原子提交；当前会话保留。退出全部会话包含当前会话。旧密码验证与并发登录不会复活已吊销密码。
- 用户管理仅管理员可用，支持分页、一次性 24 小时邀请、角色修改及移除。邀请链接通过 fragment 携带令牌，接受页面读取后清除 fragment；管理员手动复制交付，不发送邮件。移除账号采取停用并保留审计外键；不能移除自己或降级/移除最后一个管理员。角色修改使该用户重新登录。
- 备份是加密的 SQLite 一致性快照，保存到数据库路径旁的 `.backups/` 私有目录。密钥为独立的 `encryption.key` 文件，须与备份分别安全保存。每日 03:00 UTC 自动备份，停机错过后在启动时补做当天备份，14 天保留，最多 100 份，单份明文上限 256 MiB。
- 恢复校验密码、加密认证、完整性、外键与迁移校验和，提交后返回 `pending_restart`，不是已恢复。可在重启前取消。启动时在接入请求前执行 checkpoint、保留恢复前数据库副本、替换数据库、清理会话与未完成任务。必须确保没有其他 Panel 进程访问数据库。
- Arc Tabs 与 Dialog 本地修正官方源码中的 Radix `render` 用法，改为 `asChild` 包裹 motion 元素；保留升级兼容修复。Tabs 对齐原型的通栏分隔线和选中下划线，移除胶囊圆角并将共享键盘焦点轮廓内收，避免被横向滚动容器裁成圆弧；保留键盘与 44px 点击区域。

## 输入控件主题适配

- 全局原生滚动条在 `theme.css` 中统一使用细宽度、透明轨道与 `--scrollbar-*` 语义 token，颜色跟随浅色/暗黑主题。旧 WebKit 使用伪元素回退，高对比度模式交由系统配色；Arc 标签栏等主动隐藏滚动条的规则仍优先。不增加滚动包装组件或改变滚轮、键盘及触摸行为。

- `Input`、`SearchField`、`PasswordField` 共用 `theme.css` 的 `--input-*` token：浅色白底、弱边框，聚焦使用原型的薄荷绿边框与 3.5px 外圈，不从文字强调色推导。标签使用次要文字色，校验错误的红色边框与外圈优先于聚焦色。
- 三类控件统一禁用底色和透明度；搜索框禁用或只读时不能清除，密码框禁用时不能切换显示。密码文本为右侧显示按钮预留空间。升级 Arc 源码时保留这些适配。
- 本次仅统一控件状态外观，不新增行内请求反馈；业务请求结果仍通过全局 Toast stack 呈现。

## 表格与用量展示

- 公共 DataTable 继续使用 Arc SortableDataTable 的排序、选择与键盘行为；表面按原型采用 8px 行间距、圆角行和 0.5px 边框。`--table-row-*` 统一浅/深色默认、悬停和选中颜色，排序用表头箭头与 `aria-sort` 标识，不再整列染色。620px 以下保留 Arc 的折行布局，较宽表格在容器内横向滚动。
- `web/src/components/usage/index.tsx` 是概览、节点列表共用的紧凑百分比展示，采用原型 76×5px 渐变条及 `--usage-track` 双主题底色。标签在紧凑布局可见，桌面保留屏幕阅读器名称。
- `null`、非有限数、负数显示“无数据”；零值正常显示。大于 100 的值保留原始百分比文字，条形宽度限制到 100%，不推断告警阈值。组件仅展示调用方数值，不增加指标请求或模拟业务能力。

- Switch 使用独立 `--switch-*` token：开启为品牌渐变轨道与深色圆点，深色关闭为深灰轨道和浅色圆点，浅色关闭保留浅灰绿轨道与白色圆点。开启时去掉圆点阴影；不改变复选框等其他控件的 `--control-*` 配色或现有交互。

- 节点详情使用官方 Arc Drawer，保留列表筛选和排序，按连接、资产、网络与修订分组。Drawer 本地沿用 Dialog 的 Radix `asChild` 兼容修复，并提供中文关闭名称、44px 关闭区域和长标题换行；升级时保留这些适配。

### 节点注册脚本

注册弹框通过 `--dialog-width` 设为最大 720px，令牌旁提供复制图标；复制反馈统一使用全局 Toast。安装与注册合并为可复制 Bash 脚本，读取系统设置的 `active_origin`（只接受 HTTPS Origin），不使用尚未生效的配置或浏览器开发地址。

脚本从 `vioira/viorka-agent` GitHub Releases 获取最新正式版本，先解析版本 tag，再从同一版本下载 `viorka-agent-linux-amd64` 或 `viorka-agent-linux-arm64` 以及对应 `.sha256` 文件（单行摘要）。需先在 Agent 仓库发布正式 Release；没有安装包时明确下载失败，不回退源码构建。脚本要求 Bash、curl、sha256sum 和 CA 信任，校验平台、架构、HTTPS 与 SHA-256 后才执行文件。

安装到当前用户 `$HOME/.local/share/viorka-agent`，目录已存在则拒绝继续，不覆盖身份。失败保留目录供排查。令牌经终端隐藏输入和标准输入提供，不写进脚本或参数。注册后前台运行，终端关闭会停止；尚未提供 systemd/OpenRC 或开机自启。真实 Linux 安装与注册仍需在正式发布后验收。
