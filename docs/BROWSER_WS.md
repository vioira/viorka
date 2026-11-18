# 浏览器统一 WebSocket

节点详情与全局通知复用登录布局持有的 `/api/v1/ws`。Agent 继续使用独立的 `/api/v1/agents/ws`。详情 Tab 切换、指标历史/实时切换及页面隐藏只更新订阅，不重建浏览器连接。

## 连接与消息

握手使用会话 Cookie 和受信任的 Origin，子协议为 `viorka.browser.v1`。5 秒内发送 `{"type":"hello","csrf":"会话 CSRF","enabled":true}`，通过后接收通知 `snapshot` 和 `ready`。凭证不进入 URL。

消息为 JSON，未知字段拒绝，hello 入站帧上限 64 KiB，鉴权后为 8 MiB + 64 KiB，草稿请求体上限 8 MiB。每连接每 10 秒处理最多 120 条消息，超额暂停读取至下一窗口，不断开连接。客户端请求上限 64 个；服务端命令队列和响应队列各 16 个，命令串行执行，业务事务完成后返回响应。每个命令最长 10 秒，写帧最长 5 秒，每 15 秒心跳及会话复查。连接使用现有 128 个流连接配额。

请求示例：

```json
{"type":"request","id":"r1","method":"saveEngineDraft","params":{"id":"engine-id","body":{"version":7,"services":[]}}}
```

`method` 使用 REST operation ID，并在 `browserOperations` 显式列入白名单。`params.id` 是资源 ID，`params.query` 是字符串键值映射，`params.body` 沿用现有 JSON 请求契约。服务端直接调用注册的同一鉴权处理器，不发内部 HTTP 请求，也不接受任意路径。现有角色、节点引擎授权、字段校验、CSRF、审计来源、版本冲突和业务幂等语义均保留。

响应示例：

```json
{"type":"response","id":"r1","status":200,"data":{"version":8,"services":[]}}
```

失败响应的 `data` 为现有 `code/message` 错误对象。202 只表示持久任务提交，后续任务事件表示执行进度。断线、超时和取消不撤销已提交操作；客户端不自动重发命令，仍使用现有幂等键和任务状态核对结果。

## 订阅

```json
{"type":"subscribe","node":"node-id","engine":"engine-id","enabled":true,"scope":"node=node-id&view=live","generation":3}
```

每条连接保留一个节点上下文、一个选中引擎和一个指标范围。`scope` 沿用指标接口的固定视图与列表游标参数；空字符串暂停指标，`node` 为空恢复全局业务事件。`generation` 随指标订阅变化递增，客户端丢弃旧代次指标。服务端通过 `DemandSubscription.Update` 调整采样需求，关闭连接回收需求。

推送为 `{"type":"event","event":"change","data":{...}}`。节点变化包含节点记录，任务变化包含脱敏任务记录，引擎变化包含摘要，选中引擎额外包含配置；当前节点监控设置变化包含配置及确认状态。历史落库后，服务端更新已订阅的历史视图。配置推送不覆盖未保存的表单输入。

`metrics` 消息附带 `generation` 和现有指标帧：实时视图按 2 秒窗口、其余视图按 5 秒窗口合并变化，保留采样游标、字段裁剪、分组增量和重置语义。初始订阅和视图切换发送当前视图快照。列表使用摘要。

业务 Hub 先订阅再读取快照，溢出发送 `ready` 要求客户端重新同步，指标发送 reset 快照。Hub 非持久且不保证变化顺序，推送读取最新持久状态，不承诺事件回放。重连重新认证和订阅，前端保留已有数据，重新读取当前资源。

系统设置 `sse` 保留原字段名，其在 WS 上表示自动推送开关：关闭后暂停业务/指标更新并释放采样需求，WS 查询和配置操作继续可用。原 REST 和 SSE 接口保留给现有调用方，登录布局及节点详情使用 WS。

## 验证

后端测试覆盖握手身份/Origin/CSRF、操作白名单、逐命令角色校验、资源 ID 校验、同连接视图切换和关闭推送后的查询。前端测试覆盖请求响应关联、错误映射、取消、断线不重发、指标代次过滤、隐藏/恢复及订阅清理。实际浏览器验收检查网络面板仅一个 WS、Tab 切换不新增握手，以及操作与状态推送。

## 首页总览

首页在同一条 `/api/v1/ws` 连接的 `subscribe` 帧中携带 `overview`，离页时省略该字段以取消订阅。

```json
{"type":"subscribe","enabled":true,"overview":{"generation":1,"traffic_generation":2,"range":"week","timezone":"Asia/Shanghai"}}
```

服务端分别发送 `overview` 和 `overview_traffic` 事件，帧顶层携带对应的正整数代次，数据沿用总览 REST 的结构及权限。流量支持 day、week、month。切换范围只递增流量代次，手动刷新递增两项，客户端丢弃旧代次帧。首订阅、重连和溢出重同步发送完整快照。

自动更新按变化合并，每连接总览统计最多每 5 秒查询一次，流量趋势最多每 60 秒查询一次。仅查询时间变化时跳过发送。统计覆盖任务的 24 小时窗口和流量额度告警过期；趋势按订阅时区滚动日期并更新数据完整性。关闭自动更新仍可读取初始快照、切换范围或手动刷新。单项失败分别发送 `overview_error` 或 `overview_traffic_error`，页面保留已有数据并通过 Toast 提示重试。

## 任务中心与节点历史

`subscribe.views` 完整替换当前页面订阅，每种视图每条连接最多一项。省略某项会立即取消它。每项携带独立的正整数 `generation`。首读、重连、重同步、手动刷新和切换范围返回当前快照，客户端按视图和代次接收数据。自动更新关闭时仍可首读、翻页和手动刷新。各视图读取失败时返回同名加 `_error` 的事件。

| 视图 | 订阅参数 | 自动更新 |
| --- | --- | --- |
| `task_page` | `state`、`after`，分页固定 50 条 | 按任务变化和节点更名合并，最多每秒读取一次。沿用服务端筛选、游标及排序。 |
| `task_summary` | 无 | 最多每 5 秒计算一次，含近 24 小时窗口到期。翻页只替换分页订阅。 |
| `metric_trends` | `node`、`range`，支持 1h、6h、24h、2d、7d | 历史提交后最多每 30 秒更新一次。服务端在时间桶结束时推进有数据的窗口。 |
| `minute_history` | `node`、`range: "10m"` | 最多每 60 秒更新。首帧 `reset: true`，后续 `points` 只含新增或修订桶，`removed` 为移出的桶起始 Unix 秒。 |

历史图离开页面、切回实时或隐藏标签页时取消对应订阅，恢复时取新快照。任务详情和流量校准按 `changes.task_id` 订阅 `tasks`，直接采用匹配的任务数据。引擎摘要增加 `published_revision` 和 `published_enabled_services`，节点概览用它们判断服务数是否已确认。

恢复核对页通过已鉴权 WS 命令分页首读，订阅 `changes: [{"kind":"recovery","all":true}]` 后按引擎更新已加载记录。命名引擎变更沿用单条核对接口的角色与节点授权，整体失效时重新同步已加载的分页。运行配置仅通过独立的 `getEngineConfiguration` 命令按引擎 ID 和任务 ID 读取，普通任务帧继续脱敏。
