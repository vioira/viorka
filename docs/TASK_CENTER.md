# 任务中心

任务中心 `/tasks` 已接入持久化任务，按 `docs/design.html` 组合统计、状态筛选、任务列表和详情抽屉，使用 Arc MetricCard、SegmentedControl、SortableDataTable、Drawer、Button 与应用全局 Toast stack。

## 接口与统计口径

- `GET /api/v1/tasks`：viewer/operator/admin 均可读取实例范围任务，沿用当前实例级角色模型。`limit` 默认 50、最大 100；`state` 为 `all` 或数据库任务状态白名单；`after` 为上一页的 `next_cursor`。按创建时间、ID 降序排序，游标独占，未知游标返回 400。未知或重复查询参数也返回 400。
- `GET /api/v1/tasks/summary`：返回 UTC 的 `since`、`until` 及其 24 小时窗口内创建的任务数、成功数、失败数。自动重投仍算同一任务。成功率为 `succeeded / (succeeded + failed) * 100`；没有成功/失败结果时返回 `null`，页面默认显示 `0.0%`。`active` 是全部时间范围内处于 queued/dispatched/accepted/running 的当前任务数。
- `GET /api/v1/tasks/{id}` 与节点任务列表/创建响应：在既有字段上增加节点名称、创建/更新时间、最大尝试次数与安全错误码。没有增加 Agent 协议字段，也不返回数据库中的任意错误文本或任务配置载荷。
- 现有任务提交接口仍只允许 `node.inspect`。operator/admin 可从失败详情“重新检查节点”，创建新任务及审计记录，保留原失败任务。请求结果不明确时复用新任务的幂等键；viewer 无提交权限。节点禁用、CSRF、Origin 和操作类型限制仍由服务端检查。

列表、统计和详情首次读取后，通过共享 SSE 的 tasks 变更事件按需刷新；重连 ready 时重新同步，离开时取消请求。任务创建、派发、回执和超时仅在实际状态写入成功后发布事件，不再每 5 秒轮询。关闭 SSE 时保留手动刷新入口。

筛选和翻页读取成功后才切换当前视图。请求失败通过全局 Toast 提示，保留原数据、列表和抽屉结构；顶部统计在尚无数据时默认显示 `0`（成功率为 `0.0%`），读取成功后更新。列表和详情首次读取失败仍保留未知状态。详情读取失败后禁用依赖最新状态的重新检查，使用已有刷新入口恢复。

## 真实能力边界

详情区分持久化、是否派发以及最终状态。`attempt > 0` 只能证明发生过派发，不能证明 Agent 已确认或成功。没有逐阶段历史时间戳，不生成模拟执行日志。耗时使用终态的 `updated_at - created_at`，明确包含排队和重投等待，不等于 Agent 实际执行时长。

尚未提供引擎操作、配置发布、取消任务或原任务手动重新排队接口。原型中的这些能力没有用演示按钮代替。读取结果只来自 Panel；浏览器不连接 Agent。

## 验证

- `go test ./...`、`go vet ./...`、`./scripts/validate.sh`、`go test -race ./...`。
- 新增真实临时 SQLite 测试覆盖排序、跨节点汇总、筛选、分页、统计窗口、错误码和存储故障；HTTP 测试覆盖身份/角色、无效参数、未知任务与依赖失败，生成的 OpenAPI 响应契约也参与验证。
- `python3 scripts/e2e_agent_connection.py` 使用独立临时数据库和真实 Agent，包含完成检查后查询全局列表、元数据和统计的断言。
- `pnpm --dir web run typecheck`、`pnpm --dir web run test`、`pnpm --dir web run build`，并对改动文件执行 Biome 检查。API 测试覆盖无效响应、跨任务响应、取消和权限失败。

这些命令是验收入口；具体执行结果以当次交付记录为准。开发预览使用独立临时数据库，不修改已有节点或部署配置。

## 引擎失败诊断

engine.manage.v4 的失败回执携带阶段和脱敏原因。任务详情显示失败/中断阶段、具体原因及可选 HTTP 状态/退出码；任务中心与节点任务列表的失败提示同步显示原因。diagnostic 保存于现有 result_json，沿用任务授权和实时 tasks 更新。字段长度、阶段和数值在服务端接收边界校验，成功结果不能附带错误诊断。旧结果无诊断时仍显示原有错误码说明。

Agent 将阶段持久化到 Journal，异常中断后在任务重投时补报最后阶段；没有系统证据不将 SIGKILL 直接标记为 OOM。配套协议见 api/agent/v1/README.md。
