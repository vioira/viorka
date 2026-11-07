# AGENTS.md — Viorka 控制平面协作规范

本文件约束本仓库的开发与交付。当前实现以代码、调用链和测试为准；设计文档、路线图、数据库表和页面入口的存在，都不能单独证明功能已经交付。

## 0. 工作原则与开发阶段

- **用户当前需求与明确约束优先**。开始前检查 `git status`、暂存及未暂存改动，核对相关实现、测试、配置与文档；不要覆盖用户工作。
- **当前仍是内部开发测试阶段，不要求历史数据兼容或旧库迁移**。可以按任务调整建库 SQL 和协议模型，使用全新、隔离的测试数据库验证，不为旧数据增加兼容分支或迁移工程。现有迁移执行器、校验和、约束及备份恢复功能仍须正确；不能绕过校验，也不能擅自删除或重置已有数据库。
- 小范围、按职责修改，不为未来需求预建空包、通用框架或批量占位文件。契约变化同步实现、生成产物、文档和测试，不能悄悄改变语义。
- 禁止用静态演示数据、空函数返回成功、吞错或无响应按钮代替业务能力。未接入功能必须明确标记或禁用，演示数据不得冒充运行数据。
- 不可逆操作、真实节点变更、数据清理、密钥切换及扩大网络暴露面须遵守用户授权；说明影响和恢复方式，不擅改部署配置。
- 交付说明实际修改、契约影响、已执行验证、未执行项及原因。代码存在、本地测试通过、跨仓库同步、实机验收和已发布是不同状态。

### 按任务阅读资料

| 任务                   | 优先阅读                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 架构与仓库边界         | `docs/ARCHITECTURE.md`、`docs/REPOSITORIES.md`、相关 `docs/decisions/`                                           |
| 启动、配置、安全与存储 | `docs/GETTING_STARTED.md`、`docs/DEVELOPMENT.md`、`docs/DEPLOYMENT.md`、`docs/SECURITY.md`、`docs/DATABASE.md`   |
| REST、Agent、实时事件  | `internal/httpapi/`、`api/agent/v1/README.md`、`api/agent/v1/envelope.schema.json`、`docs/PROTOCOL.md`           |
| 引擎、预设、出口与分流 | `docs/ENGINE_SERVICES.md`、`docs/ENGINE_SERVICES_VALIDATION.md`、`docs/PROTOCOL_PRESETS.md`、`docs/OUTBOUNDS.md` |
| 监控、任务、NAT        | `docs/MONITORING.md`、`api/agent/v1/TELEMETRY_V3.md`、`docs/TASK_CENTER.md`、`docs/NAT_AND_RELAY.md`             |
| Web                    | `web/package.json`、`web/README.md`、`.agents/skills/arc/SKILL.md` 及第 7 节                                     |

部分文档仍保留早期阶段描述，`docs/ROADMAP.md` 是规划而非验收清单。发生冲突时沿实际入口核对，报告或修正本次任务涉及的过时描述；不编造缺失路径、命令和完成状态。

## 1. 当前实现与代码定位

### 技术栈与模块

- 后端是 Go 单体服务，版本以 `go.mod` 为准；使用标准库 HTTP、`coder/websocket`、`modernc.org/sqlite`。Huma 用于 OpenAPI/Schema 生成，处理器仍负责运行时解码、鉴权和校验。
- 前端是 React + TypeScript strict + Vite + React Router，使用 pnpm、Tailwind CSS、Arc、Ky、Vitest 和 Biome；版本以 `web/package.json` 和 `web/pnpm-lock.yaml` 为准。
- 默认单 Panel 进程、单 SQLite 数据库。Go 服务与 Web 静态资源分开构建和部署，当前没有在 Go 二进制中嵌入 Web。

| 位置                                                     | 当前职责                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| `cmd/server`、`internal/app`                             | 启动装配、管理员初始化、恢复、后台任务与关闭                    |
| `internal/platform/config`、`internal/platform/geoip`    | 环境配置校验、可信代理配置、本地 GeoIP 适配                     |
| `internal/httpapi`                                       | REST/SSE、Agent HTTP/WSS 入口、权限、DTO、路由与 OpenAPI 元数据 |
| `internal/auth`                                          | 密码与会话、邀请、Passkey、登录历史、Agent 注册和签名会话       |
| `internal/inventory`                                     | 节点模型、资产与地区解析边界                                    |
| `internal/proxy`                                         | 引擎/服务草稿、校验、协议预设、共享出口与分流模型               |
| `internal/scheduler`                                     | 任务服务与仓储接口；通用创建入口只允许 `node.inspect`           |
| `internal/gateway`                                       | Agent 连接、能力协商、任务派发、监控快照与实时采样需求          |
| `internal/monitoring`                                    | Telemetry 接收、实时缓存、聚合、历史写入、质量与诊断            |
| `internal/realtime`                                      | 进程内变更通知 Hub；持久通知与任务由 storage 保存               |
| `internal/settings`、`internal/audit`                    | 系统设置、备份/恢复/计划任务；审计读取边界                      |
| `internal/storage`                                       | SQLite、事务、任务状态、引擎目标与操作、加密、资产、历史及审计  |
| `protocol/v1`、`api/agent/v1`                            | Go 协议模型/校验与引擎目录；权威 Schema、示例和版本说明         |
| `migrations`                                             | 嵌入式建库 SQL、schema 变更与开发回滚 SQL                       |
| `web/src/api`、`web/src/router`、`web/src/hooks`         | 请求/DTO、路由/会话 loader、共享实时和反馈逻辑                  |
| `web/src/views`、`web/src/layouts`、`web/src/components` | 页面、共享布局、业务复用组件和 Arc 源码                         |

`internal/orchestrator`、`internal/telemetry`、`internal/subscription`、`internal/platform/events` 当前只有设计占位；`internal/domain` 只有部分资源定义。不要将其写成已运行的编排器、监控服务、订阅服务或完整领域层，也不要为了匹配目录名搬动现有实现。

### 已接入与未完成范围

- 代码已接入认证/用户管理、节点注册与资产、任务中心、审计、通知、设置、备份、Telemetry v3，以及节点详情中的引擎与服务管理、协议预设和共享出口。引擎任务、流量校准有专用入口，不能因通用任务 API 只接受 `node.inspect` 就断言它们未实现。
- 当前引擎能力为 `engine.manage.v3`，监控能力为 `node.telemetry.v3`，以 `protocol/v1` 常量和协商代码为准。各引擎能力不同，不能只看名称或版本号推断支持范围；实机验收边界见 `docs/ENGINE_SERVICES_VALIDATION.md`。
- 总览 `web/src/views/home` 使用明确标记的演示数据；`topology`、`subscriptions` 页面尚未接入业务；`proxy-services` 页面引导到节点详情，不是独立的全局服务管理页。
- 现有 UI 尚未全面符合第 7 节：主题仍有非 Radix 色值、渐变和彩色阴影，部分页面仍有中点分隔、11px 文字和多余动效。它们是待整改项，不是新代码可照搬的规范；修改相关界面时按规则清理，文档更新不等于 UI 已整改。

## 2. 仓库边界与代码组织

- 本仓库是控制平面。`viorka-agent` 是独立仓库，负责本地探测、身份保管、下载、进程监管、配置验证/应用/健康检查/回滚。不要把 Agent 常驻程序或代理数据平面塞入 Panel。
- 浏览器只连接 Panel，不连接 Agent、不获得 Agent 私钥。Panel 通过授权、类型化、可审计的 Agent 操作管理节点，不提供任意远程 Shell，不通过 SSH 或本机远程命令绕过 Agent。
- Panel 不转发用户代理业务流量；sing-box、Xray、Realm 承担数据平面。Panel 暂时失联不应停止节点已有代理进程。
- Panel/Agent 独立发布；产品版本、REST 版本、Agent Envelope 版本和能力版本相互独立。Schema 同步不等于制品已发布或旧 Agent 已兼容。
- 不提前引入 Redis、NATS、Kubernetes、微服务或分布式锁。当前任务领取和连接索引不能直接作为多进程、多实例方案。
- **按职责拆分，不按行数拆分**。优先在同一 Go package 内拆文件，不把逻辑堆进 `router.go`、`service.go`、`App.tsx` 或通用 `utils/common`，不机械拆出单函数包或每个 struct 一文件。
- HTTP 层负责协议适配，业务校验放所属模块，SQL 与事务放 `internal/storage`，依赖由装配层注入；领域规则不依赖 HTTP、SQL、WSS 或前端 DTO。沿现有小接口扩展，避免循环依赖、跨模块直接访问表或内部状态；不得把当前部分 handler 直接调用仓储的结构夸称为完整分层架构。
- 区分 DTO、业务语义与持久化需求；现有类型有复用时按本次边界合理调整，不为每个简单对象机械新增多套类型。状态保持最小作用域，明确复用后再上提，测试随模块就近放置。

## 3. Go、HTTP 与服务生命周期

- 使用 `go.mod` 指定的版本和 `gofmt`，优先标准库及显式依赖。错误用 `%w` 包装、`errors.Is/As` 分类，不靠错误文本判断业务类别、不吞错、不用 panic 处理可恢复失败；在实际处理边界记录一次错误。
- I/O 和耗时操作传递 `context.Context`，保留取消与 deadline。持久任务提交后由服务生命周期驱动，不能继续依赖已结束的 HTTP 请求 Context。
- 数据库、外部请求、握手、任务与关闭均有超时；SSE/WSS 使用独立心跳、写超时和取消策略，不套用普通 REST 超时。
- 每个 goroutine 有所有者、停止条件和回收路径；并发、队列、缓存、重试和日志量有界，共享状态明确同步。关闭时停止接入和派发，有限等待在途工作，回收长连接和后台任务，最后关闭存储，保留可恢复任务状态。
- 配置集中加载并校验。默认服务监听 `127.0.0.1:8080`；不为调试擅自扩大监听、关闭 TLS 验证或弱化 Origin/可信代理检查。

### REST 与 OpenAPI

- REST 基线是 `/api/v1`。使用 `internal/httpapi` 的 `registerRoutes`、模块注册函数和 `routeRegistry.handle` 维护路径、角色、DTO、状态码及说明；运行 `make generate-openapi`，提交生成的 `api/openapi/openapi.yaml`，禁止手改生成文件。
- Huma 生成文档不会自动完成运行时校验。保留统一 JSON 解码、未知字段拒绝、请求体大小/Content-Type/字段范围校验；特殊上传和流协议明确各自限制，不悄悄切换错误结构或引入默认 422 行为。
- 列表设置有界分页、稳定排序和筛选白名单，沿用实际游标语义；不把客户端对已读记录排序宣传成服务端全量排序，SQL 不拼接用户排序字段。
- 错误返回真实状态和稳定 `code`、安全 `message`，区分参数错误、未认证、无权限、冲突及依赖失败；不得泄露 SQL、堆栈或 Secret。当前未统一输出 request ID，不能声称已有完整请求追踪。
- 长时操作按契约返回持久任务及通常为 202 的响应；**提交、派发、Agent 接收、执行成功**分别展示。`/healthz` 表示存活，当前 `/readyz` 检查 SQLite，不代表所有 Agent 或引擎健康。

### SSE 与监控

- 业务流 `/api/v1/events` 与指标流 `/api/v1/metrics/events` 分工明确，均须鉴权、有界订阅、取消清理和背压处理。先订阅再读取快照；重连/溢出按 `ready` 或 reset 重新同步，不声称支持 `Last-Event-ID` 持久回放。
- 管理连接在线、指标新鲜度、设置已应用和实时需求已确认是不同状态。缺失/过期数据不能补零、伪造样本；接收回执不等于历史已刷盘。
- 保留 Telemetry v3 的身份、能力、批次、时间、序号、需求租约与限流校验，大整数计数遵循十进制字符串契约。聚合、保留窗口和单位以代码及 Schema 为准。
- 时间用 UTC 存储/传输，前端按用户时区显示。高频采样使用有界缓存和时间桶持久化，不逐点无限写入 SQLite。

## 4. 身份、权限与敏感数据

- Web 用户与 Agent 身份独立。管理 API 默认拒绝未认证请求，公开入口按路由明确声明。当前 `viewer/operator/admin` 为实例级角色，引擎管理另有节点授权，不能描述为已有组织/租户隔离。服务端校验角色、资源归属与适用授权，不信任客户端角色或隐藏按钮。
- 沿用 bcrypt、Cookie 会话、Origin/CSRF 和 Passkey 实现。Cookie 保留 `HttpOnly`、`SameSite`，HTTPS 环境启用 `Secure`；携带凭证的 CORS 禁止通配来源，密码/会话/CSRF Token 不存入浏览器持久化状态。
- Enrollment Token 有时限、撤销与原子消费；Challenge nonce 一次性、限期、绑定身份和上下文。保留现有受限的丢响应恢复语义，不自行发明加密或重放协议。
- HTTPS/WSS 验证证书和主机名，凭证不放 URL query。吊销同时处理后续认证和活跃连接；任务回报来自匹配节点的已认证会话。
- Gateway 按协议与能力协商，WSS 保持单 reader/单 writer 或库支持的并发模型，并限制帧大小、解码深度、发送队列和速率；不能用监控流量挤掉任务确认或终态。
- 引擎凭证、私钥、敏感命令和配置静态加密；当前引擎密钥是数据库旁的独立 `.engine-key` 文件，保留权限及备份/恢复关系。日志、Toast、SSE、审计和普通任务响应不得泄露原始凭证或完整秘密配置。
- 节点解绑、身份重注册、Agent 卸载、引擎卸载和服务删除是不同操作。第三方引擎只读发现，当前不提供接管；不得覆盖、停止或自动转为 managed。
- 删除、批量应用、恢复备份、旋转凭证等风险操作说明对象和影响范围，保留确认及恢复路径；普通低风险编辑不增加无意义确认。

## 5. SQLite、引擎目标与可靠任务

- 存储经 `internal/storage` 访问。当前 SQLite 配置外键、`busy_timeout`、WAL，限制为一个打开连接；不在网络文件系统或多主机间共享运行中的数据库。SQL 参数化，关键唯一性、外键、状态和范围由数据库约束兜底。
- 保持短事务，网络访问不进事务。Desired 目标、不可变 Revision、任务及审计按所属流程原子提交；目标调和流程保证已提交目标可恢复派发，不能派发未提交任务或目标。
- 草稿版本和资源 Revision 处理并发冲突，不静默覆盖。Observed 只经匹配节点、资源、task、attempt、revision 和命令摘要的可信回报推进，迟到消息不能回退状态。
- 任务至少一次投递，依靠节点范围幂等键、Agent 幂等执行及最终确认，不承诺网络 Exactly Once。沿用持久状态机、领取/租约、deadline 和恢复路径；发送成功或 ack 不等于执行成功。
- 同资源冲突操作串行，重试有上限、退避和抖动，区分永久失败、暂时失败及结果未知。未知副作用先查询/调和 Observed，不盲目重放；回滚失败或状态不明明确报告，不能静默丢弃任务终态和关键审计。
- 引擎应用、启动/停止和运行意愿不同。目标/派发逻辑当前在 `internal/storage/engine_*.go`，改动同时检查 Gateway 与专用 HTTP 入口，不能只改 scheduler。
- 恢复配置不能重新启用已旋转失效的旧凭证；保留脱敏、端口保留与失败恢复语义。备份/恢复走现有快照及校验流程，不以直接复制运行中数据库替代一致性快照。
- schema 变更遵循第 0 节，同步建库 SQL、约束、存储测试和快照校验；无需历史迁移不等于可以省略新库初始化、事务、校验和或恢复测试。

## 6. 代理、端口与 NAT 边界

- 每节点每种引擎最多一个托管实例，服务固定所属节点和引擎。发布、升级、重启可能影响同引擎全部服务，按真实影响范围处理。
- 版本、下载目录、参数以 `api/agent/v1/engine-releases.json`、协议校验和已验证的 Agent 适配为准。不猜 CLI、热加载、平台或协议能力，不把本地测试当成 Linux/systemd 与外部客户端实机验收。
- Panel 保存结构化草稿、目标和任务，Agent 做本地端口检查、配置验证、应用与健康检查。预设/出口多处引用时保留引用版本、影响预览、并发冲突及全部关联节点权限检查。
- NAT 能力由地址、公私端口、TCP/UDP、映射归属和可达性共同表达，不能只依赖节点 `kind`；已有表和模型不代表完整 NAT/拓扑编排已接入。
- 端口冲突检查覆盖同节点其它引擎/服务、通配监听、IPv4/IPv6 与传输协议，执行端二次校验。服务商公网映射默认只读，节点 root 权限不代表能修改服务商映射；不为无 UDP 能力的节点生成 UDP/QUIC 部署。

## 7. 前端与 UI 规范（强制）

### 7.1 目录、请求与状态

- 页面位于 `web/src/views/<kebab-case>/index.tsx` 并默认导出；局部组件放同目录 `components/`，跨页面复用后再上提。入口负责组合，表格、表单、弹层和复杂交互按职责拆分。
- API/DTO 在 `web/src/api/`，路由/loader 在 `web/src/router/`，共享布局在 `web/src/layouts/`，全局样式在 `web/src/assets/styles/`。API 不依赖页面或路由，纯工具不夹带共享业务状态。
- 普通 JSON REST 统一经 `web/src/api/client.ts` 的 `apiRequest`：同源 `/api/v1`、Cookie、显式 CSRF、取消信号和类型化 `ApiError`。当前默认 12 秒、不自动重试，客户端自身不跳转、不弹 Toast；SSE、下载和流传输使用独立策略。
- 会话以路由 loader 为准，通过现有布局 Context 传递，不另建持久化会话 store。当前无 Zustand/TanStack Query，确有跨页面状态或缓存需求再评估。
- 复用登录布局的 `RealtimeProvider` 和 `web/src/hooks/use-live-metrics.ts`，避免重复业务连接和后台高频订阅；SSE 关闭时不擅自用轮询代替。

### 7.2 Arc 为唯一基础组件体系

1. 修改 UI 前阅读 `.agents/skills/arc/SKILL.md`，按任务阅读同目录 `components.md`、`composition.md`、`design.md`、`copy.md`、`motion.md`、`accessibility.md`、`responsive.md`，交付前检查 `checklist.md`。
2. Arc MCP 可用时先 `search_components`，再 `get_component`，比较 `whenToUse` / `whenNotToUse`。不可用时查本地源码/skill，以及官方 `https://uiarc.dev/llms.txt` 和对应组件 Markdown；鉴权失败如实报告，不能猜 props 或伪称已查询。
3. 优先复用 `web/src/components/arc` 和现有业务封装，如 `web/src/components/data-table/index.tsx`。按钮、表单、导航、表格、弹层、反馈必须使用 Arc；没有对应组件时组合 Arc primitives，普通语义布局可用 HTML。
4. `web/components.json` 已配置 `@uiarc`。确需安装时在 `web/` 使用 `pnpm exec shadcn add @uiarc/<id>`，同步源码、CSS、依赖及锁文件。shadcn 只是安装工具，不能据此换 UI 来源；不得重建 Arc 内核或仿制 Pro 源码。
5. 自写页面、布局和业务组件使用 Tailwind utility classes，不新增业务 CSS Modules 或页面级 CSS。Arc 源码保留自带 CSS Modules；共享颜色、字体和圆角等在全局 token 层维护。
6. `web/src/main.tsx` 已按 `index.css` → Arc `foundation.css` → `theme.css` 导入样式，foundation 只导入一次。用语义 token 和公开 props 定制，不以深层选择器或大量 `!important` 覆盖内核；更新官方组件时保留已验证的本地适配。
7. **本文件优先于 Arc 通用建议**：Tailwind、0.5px 边框、全局 Toast 及下列视觉文案规则按本项目执行。当前是 Vite SPA，不照搬 Next.js Server Components 或 `use client` 要求。

### 7.3 界面、文案与视觉的 11 条规则

1. **不用中点分隔文案。** 自行撰写的 UI 文案不得用 `·` 作为分隔符，review 到已有分隔符就移除，优先通过间距、分组或必要标点表达关系。不改写用户输入、真实标识符或第三方原文。
2. **删除冗余解释。** 不为每个页面、区块或控件追加“这里可以……”式描述，不重复标题、按钮或内容已表达的信息。只保留操作所需的约束、风险、单位和必要上下文；实现细节放文档，不堆进界面。
3. **按使用人群 review 文案。** 面向 VPS/NAT 与代理服务管理者，术语一致、准确、易懂，避免过于口语化、冗长和随意造词。按钮用动作加对象，如“添加节点”“保存配置”；标签短而明确，错误说明原因和恢复方法，危险确认写清对象与后果，长短适合功能场景。
4. **所有应用 UI 配色统一使用 Radix UI Colors。** 背景、文本、控件、边框、状态、图表及浮层色均从 [官方色阶](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) 映射到 Arc 语义 token；浅/深主题分别映射，透明色使用官方 alpha 色阶。1–2 用于背景、3–5 用于控件状态、6–8 用于边界、9–10 用于实色强调、11–12 用于文本，并实测对比度。大面积用中性色，强调色用于选中/关键操作，状态色只表达真实状态且配文字或图标。页面不写原始 hex/rgb/hsl/oklch、任意透明混色或 Tailwind 原始色阶，官方色值只在主题层定义。现有非 Radix 配色须在相关整改时替换，不能只改变量名；真实图片、外部品牌和用户内容保留原色。
5. **对齐与同心圆角。** 保持单层主容器，标题、工具栏、表格和内容边缘对齐，文字/图标/控件尽量做到光学对齐，不只检查盒子坐标。使用共享间距 token 和 4px 网格；需要嵌套圆角时，以外圆角减内缩距离作为内圆角起点，避免内外轮廓不协调。
6. **边框与分隔线使用 1px。** 容器、控件、表格和布局分隔统一使用 1px，例如 `border-[1px]`，配语义边框色，检查不同缩放/像素密度下的显示。键盘焦点指示保留 Arc 可访问性规则；图标笔画和数据图线按可读性处理，不当作装饰边框削细。
7. **尽量减少动画与过渡。** 默认不加装饰性入场、循环、跳动、发光或 `transition: all`。只在说明必要状态变化时使用动效，普通补间以 `250ms ease-out` 为基础，优先统一到共享 motion token；不额外叠加 Arc 已有动效，尊重 `prefers-reduced-motion`。
8. **每页最好 3 种字号，最多 4 种，最小 12px。** 包括正文、辅助信息、表格、按钮和标签，优先使用 Arc `--text-*` token。层级不足时先调整 400/500 字重、语义文字颜色、间距和留白，不再加字号；中文有系统字体回退，变化数值用 `tabular-nums`，截断文本保留完整内容的可访问入口。
9. **减少不必要的判断和选择。** 先确定任务与信息优先级，每页一个 `h1`，每个独立操作区尽量只有一个主要动作。低风险常规操作直接完成，必要选择放在用户本来就在选择或配置的位置，不在操作后插入额外决策；危险操作保留确认。按主次组织内容，低频操作用次级入口，不将所有功能等权铺开。
10. **圆角与阴影必须有用途。** 不随意加圆角、嵌套卡片和阴影，禁止卡片左侧彩色线条、装饰渐变、彩色阴影、发光和图标背景底板。圆角使用适合控件/容器的共享 token；静态区块优先靠留白与细边界区分，阴影仅表达浮层层级，强度与场景匹配。
11. **减少 Eyebrow 和 Overline。** 不习惯性地在标题上方添加英文大写小标题，不保留与主标题重复或纯装饰的小标签。只有它提供主标题未表达的分类、上下文或关键信息时才保留；优先用字号层级、字重、间距和留白组织界面。

### 7.4 全局消息与真实状态

- 成功、失败、警告、信息及请求异常统一使用 Arc Toast stack。`web/src/main.tsx` 已挂载一个 `ToastStackProvider` 和一个 `ToastStack`；页面、表单、弹层共享队列，不另建通知栈，复用 `useToastStack` 或 `useToastFeedback`。
- 禁止插入行内结果提示、错误横幅、提示卡片或整页错误区导致布局跳动；请求失败不能替换表单、表格或页面主体。保留输入和已有内容，首次加载失败保持未知/未读取状态，依赖数据的操作禁用，不伪造默认值或空数据成功。
- 同一错误使用稳定通知 ID 去重；取消请求不提示错误。需要恢复时在 Toast 提供重试，或复用已有刷新入口；敏感凭证不进入 Toast。
- 加载、空数据、权限、离线、过期和业务持久状态属于页面内容；字段标签、约束和危险操作确认保留，不能借此变相展示请求结果消息。成功后更新真实数据，任务执行中不能提前标记完成。
- 本规则覆盖 Arc skill 的“行内错误/原位成功提示”建议。通知中心是持久通知入口，不代替即时 Toast，也不为请求结果新建页面区块。

### 7.5 可访问性与 UI 验收

- 使用语义标签、可访问控件名称，图标按钮不只靠 Tooltip 命名；键盘可操作，弹层管理焦点并在关闭后归还。保留 Arc 的 `:focus-visible`，不自行添加鼠标焦点光圈。
- 正文对比度至少 4.5:1，必要大字和控件边界至少 3:1，不能假定用了 Radix 色阶就自动合格。状态不只靠颜色，动态状态可被读屏获知。
- 检查 390/768/1024/1440px、浅/深主题、长内容、键盘和触摸；宽表格内部滚动，页面不横向溢出，触摸目标至少 44px，Hover 信息也能通过焦点及触摸获得。
- 覆盖加载、空、失败、成功、禁用及离线/未知状态，特别检查请求前后布局稳定、弹层内 Toast 可访问和窄屏显示。对照上述 11 条 review，未做浏览器检查须说明，不只凭构建通过宣称 UI 合格。

## 8. 协议、生成文件与验证

### 生成与同步

- `api/agent/v1/envelope.schema.json` 是 Agent wire Schema 权威源，示例不授予执行权限。协议变更同步示例、Go 校验、能力协商、双方模型和说明；明确匹配版本要求，开发期省略旧兼容不等于允许静默接受不匹配协议。
- 运行 `python3 scripts/generate_protocol.py` 生成 `protocol/v1/models.gen.go`，用 `--check` 检查漂移，不手改生成模型；手写解码和语义校验仍须同步维护。
- `scripts/sync_engine_protocol.py` 同步引擎辅助代码、目录和 Schema，默认写入相邻 `viorka-agent` 仓库。先核对路径和授权，必要时用 `--agent <路径>` 指定目标；`--check` 只检查同步，不证明两端可运行，跨仓库修改分别验证和交付。
- REST 使用 `make generate-openapi` / `make check-openapi`。产品版本以 `internal/httpapi/router.go` 的 `Version` 为源，同步 `web/package.json` 和生成的 OpenAPI；普通改动不顺带运行会提交、打标签、推送的发布流程。

### 按改动范围验证

| 改动                     | 必要验证与重点                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go 业务/API              | 修改文件 `gofmt`；运行 `./scripts/validate.sh`，已包含 `go test ./...`、`go vet ./...`、构建、版本/Schema/协议/OpenAPI 检查；覆盖参数错误、未认证、越权、冲突和依赖失败                                 |
| 并发/Gateway/任务/实时流 | 上述加 `go test -race ./...`；覆盖重投、乱序、断线恢复、背压、超时、取消和关闭                                                                                                                          |
| SQLite/schema/快照       | 真实临时 SQLite 验证初始化、约束、事务原子性、并发冲突、校验和及备份恢复；涉及 down SQL 时验证回滚，不要求历史版本升级链                                                                                |
| Agent 协议/身份          | `python3 scripts/check_protocol.py`、`python3 scripts/generate_protocol.py --check` 和相关 Go 合约测试；监控变更加 `python3 scripts/test_telemetry_contract.py`；覆盖重放、吊销、跨节点伪造及能力不匹配 |
| Web                      | 在 `web/` 运行 `pnpm run typecheck`、`pnpm run test`、`pnpm run build`，对改动文件执行 `pnpm exec biome check <文件>`；UI 改动另做第 7 节验收                                                           |
| 纯文档                   | 检查 Markdown、引用路径、命令与代码事实，并运行 `git diff --check`；无需全量构建                                                                                                                        |
- Python 校验依赖见 `scripts/requirements-dev.txt`；Web 使用 `pnpm install --frozen-lockfile`。依赖变更同步 `web/pnpm-lock.yaml`，不引入其它包管理器锁文件。Biome 当前排除 Arc 导入源码，不对全库运行带写入的 format 来修改无关文件。
- `scripts/validate.sh` 不含 Web 和 race；`check_schema.py` 仅验证建库语法及部分约束，`check_protocol.py` 仅验证 Schema/示例，不代表全部迁移、WSS 安全或 Agent 实机兼容已通过。
- `VIORKA_TEST_AGENT_BINARY` 未设置时真实 Agent 进程测试会跳过；长稳测试另需 `VIORKA_TEST_SOAK_DURATION`、`VIORKA_TEST_SOAK_OUTPUT` 及适用环境。报告通过项时说明这些跳过，不用普通 `go test` 成功代替实机/长稳验收。
- `.github/workflows/ci.yml` 的 Web Biome 步骤仍引用旧目录/文件，不照抄不存在的路径，也不由本地检查推断整条 CI 已通过；相关缺口单独说明。
- 新增行为测试可观察结果和不变量，不以只验证 mock 被调用的空测试充数；纯文案/样式改动不机械新增测试，以实际视觉、交互及已有检查验证。

## 9. 提交与完成检查

提交信息使用 Conventional Commits，仅在需要提交时执行：

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

- [ ] 修改只覆盖需求，保留用户已有改动；检查 `git status`、`git diff --check`，有暂存内容时检查 `git diff --cached`，不混入无关文件。
- [ ] 业务/仓库/权限边界正确，没有假成功、任意 Shell 或覆盖第三方服务。
- [ ] API、协议、schema、配置、生成文件、文档及测试按实际影响同步。
- [ ] 异步结果、未知/离线状态真实；错误、取消、重试、资源上限和恢复语义经过适用验证。
- [ ] UI 遵循 Arc、11 条视觉文案规则和全局 Toast，浏览器验收及未完成项如实记录。
- [ ] 交付说明修改、契约影响、已执行检查、未执行项及原因，不把本地实现写成已发布能力。
