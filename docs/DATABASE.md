# 数据库模型与迁移计划

> M0 已接入 SQLite 驱动和事务迁移，`0001` 包含节点及其注册令牌字段，`0002` 增加会话、挑战和任务租约。只有认证、连接和只读任务已接业务，代理配置相关表仍是后续阶段模型。见 [GETTING_STARTED.md](GETTING_STARTED.md)。

## 1. 默认 SQLite，后续 PostgreSQL

- v1 默认 SQLite，推荐 WAL 模式，`busy_timeout`、短事务、单机唯一写节点、定期备份与完整性检查。
- 不要在 NFS 或多主机网络文件系统上共享运行中的 SQLite 数据文件。
- 任务与配置发布在同一 DB 事务内完成；调度器只从已提交的数据中读取。
- Raw metrics 不逐点入库：实时保存在有限缓存，持久化独立字段的 `metrics_history`/`metrics_history_old`，按 UTC 周轮换。
- 数据访问必须放在 `internal/storage` 的抽象边界；需要 PostgreSQL 时使用独立 dialect/migrations，不假定现有 SQLite SQL 原样可直接用于 PG。

## 2. 核心实体

| 实体 | 主键 | 关联和关键字段 | 行为 |
|---|---|---|---|
| `users` | UUID 文本 | username、password_hash、role | 面板用户与 RBAC |
| `nodes` | UUID 文本 | kind、name、state、os/arch、last_seen | 公网 VPS 与 NAT VPS 节点 |
| `agent_credentials` | UUID 文本 | node_id、public_key、status | 节点身份和吊销 |
| `node_addresses` | UUID 文本 | node_id、kind、address | 一个节点多个 IPv4/IPv6/域名 |
| `port_allocations` | UUID 文本 | node_id、公私地址/端口、transport、owner | NAT 提供商/本机端口资源 |
| `engines` | UUID 文本 | node_id、name、version、ownership | 每种核心一个默认实例 |
| `proxy_services` | UUID 文本 | node_id、engine_id、listen、config | 本地代理服务（入站等） |
| `relay_rules` | UUID 文本 | source/destination 节点、listen、target | TCP/UDP 中转关系 |
| `config_revisions` | UUID 文本 | node/resource/revision/sha256/desired_json | 不可变配置期望快照 |
| `deployments` | UUID 文本 | desired_revision、observed_revision、status | 实际是否达到期望 |
| `tasks` | UUID 文本 | node、idempotency_key、attempt、state、payload | 持久化任务与重试 |
| `metrics_history` / `metrics_history_old` | node、bucket_start | 固定 30 秒均值/峰值/最新值，桶级最后采样时间 | 本周/上周分区 |
| `audit_logs` | UUID 文本 | actor、action、resource、summary | 可追责操作审计 |

节点类型仅有 `vps`（公网 VPS）和 `nat`（NAT VPS）；中转是服务用途，不再作为节点类型。`POST /api/v1/nodes` 对 `kind: "relay"` 返回 400。

当前为无节点的测试环境，直接收紧初始建库的 `nodes.kind` CHECK 约束，不提供历史节点迁移。测试使用全新数据库；已有迁移摘要不匹配时仍会拒绝启动，不自动清理数据库。

## 3. 推荐索引

已有 SQL 提供：`agent_credentials(node)`、`node_services(node)`、`tasks(node,state,created_at)`、`audit_logs(created_at)`，另有 `(node_id,idempotency_key)` 唯一键，保障消息重试时单节点去重。

注意：任务幂等除了数据库唯一键，还需要在 Agent 本地进行二次去重，否则断线重连重复下发仍可能造成副作用。

## 4. 一致性约束

- `config_revisions` 不可变、同一资源 Revision 单调增；不得直接覆盖历史配置。
- `deployments.observed_revision` 只能由已认证 Agent 的可信处理路径更新。
- `tasks.state = succeeded` 不能单凭发送完成设置，必须收到结果/健康确认。
- 创建或修改 `port_allocations` 需要核查真实端口权限：`owner = provider` 不能调用 node root 修改服务商外部端口。
- 删除节点时应区分：从面板解绑、卸载 Agent、本地配置清理，不能默认级联删除节点上真实代理进程。
- 各时间字段统一 UTC RFC3339 保存（首期文本），展示时由前端按时区转换。

## 5. 配置机密性

`proxy_services.config_json`、`config_revisions.desired_json` 可能含代理密钥，生产实现必须有**敏感字段封装加密**，不是只靠 SQLite 文件权限。密钥管理、轮换、数据库备份加密、敏感数据脱敏须在 M2 前落地。无任何明文配置不等于没有敏感日志泄漏。

## 6. 迁移规范

- 使用事务化版本迁移，启动前检查 schema version，预迁移备份。
- 添加字段需向后兼容，先扩展 schema、再迁移代码，最后删除旧字段。
- 生产迁移只向前；`down.sql` 仅用于开发和测试，不建议自动 rollback 删除用户数据。
- 在 CI 用真实 SQLite 实例跑迁移、约束、索引、备份/恢复测试。

## 7. 风险与未定点

- 完整的 RBAC/resource policy 可能需要新增 roles/permissions/memberships 表；首期 role 字段仅是草案。
- 高基数监控/审计达到单机界限后应分表/归档或迁移后端。
- `engines` 默认每节点每引擎一个实例；将来支持多实例时需迁移 `UNIQUE(node_id,name)` 约束。
- `tasks` 已有 `lease_until`、`deadline_at`、attempt；当前限定单 Panel 进程，尚无多 Worker 所有权协议，不能用于多实例部署。

## 系统设置迁移（0003）

新增 `system_settings` 单实例配置（含并发 revision）、`user_invitations` 一次性邀请和最多 100 条 `notifications`；用户新增邮箱和停用标志。旧用户默认邮箱为空、启用状态。旧迁移不变，启动自动备份并应用 `0003_system_settings.up.sql`。开发回滚须先执行 0003 down，再回滚 0002；会删除新增设置、邀请和通知。

恢复只接受当前迁移集合和校验和完全匹配的加密快照；旧版本快照需先在隔离环境升级到当前 schema。恢复时清除 Web/Agent 会话、挑战和邀请，吊销旧注册令牌，未完成任务置为失败，避免重放。

## 开发期节点与注册令牌合并

添加节点（`POST /api/v1/nodes`）在同一事务内保存节点、令牌哈希与审计，返回的 `id` 为节点 ID。令牌仅明文返回一次，有效期 15 分钟。节点的 `enrollment_token_hash / enrollment_expires_at / enrollment_used_at / enrollment_revoked_at` 管理注册状态，不再创建独立注册令牌表。未注册节点为 `pending`，注册后为 `offline`，WSS hello 后为 `online`。Agent 注册只绑定已有节点，消费令牌和保存公钥原子提交；同令牌同公钥可在有效期内恢复丢失响应，不允许绑定其他公钥。

本次按开发测试阶段要求直接修改初始建库 SQL，不提供旧库迁移或兼容。验证及新部署使用新数据库；旧库会因迁移校验和不同被拒绝，已有数据库未自动删除。

## 节点资产快照迁移（0004）

新增 `nodes.inventory_json`（可空、JSON 有效性约束），持久保存发行版 ID、名称、版本、公网 IPv4/IPv6、采集时间及不可用状态。`GET /api/v1/nodes` 将其暴露为可选 `inventory` 对象。旧节点无快照时保留原 OS 展示；离线与 Panel 重启不删除快照。按采集时间拒绝迟到更新；新采集失败会将对应字段置空并保存错误，不将旧 IP 冒充当前地址。

升级通过现有迁移机制备份后应用 0004，不修改已发布迁移。开发回滚先执行 0004 down，会删除资产快照列，保留节点及其他数据。公网地址是 Agent 通过 ipify HTTPS 直连探测得到的出口，不等于入站地址或 Provider 映射。

## 开发期监控初始化

监控历史按本次开发测试目标重新初始化，不创建或读取旧 JSON 历史表，不导入旧历史。
初始建库不再创建旧监控表或旧设置列；0009 改为 `0009_telemetry_history`，一次建立新周表、资产、检查点与分区元数据。

**使用全新、隔离的测试数据库。** 存在旧监控表或迁移摘要不匹配的数据库会被拒绝；程序不会自动清空账号、节点、任务或重建用户数据库。旧历史无转换/迁移/回迁程序；本次没有对运行中的数据库执行变更。切换二进制测试时使用各自匹配的独立数据库。

历史主表共 32 列。CPU、RAM used、Swap used 保存桶内平均值（`*_avg`）；网络速度、进程/socket 与磁盘 I/O 保存峰值（`*_max`）；容量、累计量、负载、运行时长保存最新有效值。保留 `last_sample_at` 和 `updated_at`，不持久化采样次数、协议语义、质量标记、组采样时间和过滤版本。无观测用 NULL，缺失不补零。

磁盘 I/O 仅保留读/写速度、读/写 IOPS、综合 await 和利用率六个峰值。容量保留 `disk_total`、`disk_used`、`disk_available`。不创建设备或文件系统明细表。`traffic_period_start` 表示可配置月计费周期的实际 UTC 起点，单位秒。

内存聚合器仍用次数计算当前桶平均值；落库后，每个有值的 30 秒桶权重为 1。较粗查询按桶等权平均，不按原始采样数加权。由于没有持久化原始权重，Panel 重启恢复的已存桶封存，不将后到样本混入这些桶；实时缓存仍接收新观测，新的桶正常统计。崩溃可能损失尚未刷盘的数据。`metric_ingest_checkpoints` 与覆盖桶/资产同事务提交，重复绝对快照覆盖而非累加。

`node_telemetry_settings.traffic_json` 保存网卡选择、重置日期/时间/时区、计费方式与额度，复用 revision 和应用回执。校准以 `traffic.calibrate` 持久化任务保存目标周期与上下行目标值，不修改历史桶；任务创建有操作者审计，成功结果须与任务目标完全一致，并保存 Agent 返回的校准前累计值。

聚合器每 5 秒检查，不依赖 R；单次不拆分节点一致快照，最多 512 个主桶/8 MiB 保守内存预算，单节点最多 4 MiB，暂存最多 32 MiB，为复制与编码留下预算。失败限速重试，未提交数据超过 10 分钟允许丢失并记录；ACK 不承诺数据库耐久。启动从新表恢复，进程崩溃可能丢失未提交数据。

周日起点使用 UTC 00:00。启动/运行时维护在事务中轮换本周与上周表及索引；错过多周不会把陈旧数据重标为上一周。时钟回拨保留已建立分区并报告异常。查询在同一 SQLite 读事务内分段扫描两周表，最多最近 168 小时，合并各字段桶均值/MAX/latest；缺口不插值。物理覆盖约 7–14 天，不每周 VACUUM，不承诺文件即时缩小。

旧协议指标已停止接收，不导入旧分钟桶。新历史 REST 的大字节计数使用十进制字符串；前端正在按新契约改造，尚未完成 UI 验收。

## 节点删除

管理员可在节点详情页使用 Arc Button 和 Dialog 确认删除。请求结果共用全局 Toast stack，成功返回节点列表，失败保留详情与弹窗内容。

- `DELETE /api/v1/nodes/{id}` 仅限管理员并校验 Origin/CSRF。成功返回 204，节点不存在返回 404，ID 超过 128 字节返回 400。
- 一个事务内检查依赖、删除节点和写入 `node.delete` 审计。外键级联清理注册身份、会话、挑战、地址与端口记录、已结束任务、监控历史及通知；既有审计保留。
- 存在 queued/dispatched/accepted/running 任务时返回 `409 node_tasks_active`；存在引擎、代理服务、入站/出站中转引用、配置修订或部署时返回 `409 node_in_use`，不自动移除这些依赖。
- 写入锁覆盖依赖检查和删除，防止并发任务创建穿过检查。延迟指标写入跳过已删除节点，不恢复其历史，也不影响其他节点的写入。
- 删除成功后关闭管理连接，旧凭证与未消费挑战均不可用。此操作不可撤销，不卸载 Agent、不改变节点上的代理进程或服务商映射；恢复管理需重新添加并注册。

## 通知已读状态迁移（0007）

新增 `notification_reads`，以 `(user_id, notification_id)` 为主键，仅存已读记录；无记录表示未读。状态按当前 Web 用户隔离，通知或用户删除时级联清理。升级沿用现有自动备份与迁移流程，旧通知对每位用户默认未读；开发 down 只删除已读记录，保留通知本身。

`GET /api/v1/notifications` 和 SSE snapshot/notifications 增加当前用户的 `read` 布尔字段。`PUT /api/v1/notifications/{id}/read` 接收必填 `{"read":true|false}`，仅更新会话所属用户；viewer/operator/admin 均可操作，要求 Origin/CSRF，成功 204，不存在 404，重复设置幂等。接口不能指定其他用户。通知仍最多保留最近 100 条，未读数量也以此窗口为准。

批量标记使用 `PUT /api/v1/notifications/read`，接收 `{"ids":["通知 ID", "..."]}`（1–100 个唯一、非空且不超过 128 字节的 ID）。沿用单条接口的角色与 Origin/CSRF 校验，状态仅属于当前用户；在一个事务内检查全部 ID，再用一条 INSERT SELECT 批量标记已读并在提交后发布一次通知变更。成功 204，任一 ID 不存在时整批返回 404 且不修改状态，无效列表返回 400，重复提交幂等。请求未包含的新通知保持未读。

## 新监控存储验证

真实 SQLite 测试覆盖新库初始化、关闭重开、原子检查点、写入失败回滚、两次周重命名、外键/索引、跨周迟到、多周追赶、时钟回拨及节点删除。已移除要求保留旧历史或迁移旧统计列的测试；非监控账号、节点、任务和配置的保留约束仍有覆盖。完整协议接收、前端和资源验收仍待后续阶段。

### Telemetry v3 settings

`0010_telemetry_settings` adds `node_telemetry_settings`, keyed by node with
ON DELETE CASCADE. Its revision, C/R/W values and settings result are independent
of legacy node settings. Missing rows mean v3 defaults (C=30/R=60/W=2, revision 1)
for an existing node; no legacy value migration is performed. Saving settings
checks the expected revision and writes its audit entry atomically. Results only
apply to the current revision and cannot regress an applied result. This table
is configuration state, so weekly telemetry history rotation does not touch it.

### 开发期旧 Agent 设置清理

旧 Agent 设置相关的 0005、0006、0008 SQL 及退役迁移已删除，新库直接使用 telemetry v3 设置表，不再先创建旧列再删除。其余初始化 SQL 保留原编号，不提供旧设置升级或数据转换；开发测试使用全新隔离数据库，程序不会自动删除已有数据库。旧 `/nodes/{id}/settings` 接口与对应代码已删除。

## 开发中的引擎存储

引擎草稿、节点授权、端口保留、不可变操作快照和有效凭证由初始 Schema 定义。本次依内部开发阶段约定不提供历史数据库迁移。使用新的开发数据库，禁止自动删除旧文件。加密数据依赖数据库旁独立的 `.engine-key` 文件，备份必须保留配套密钥；详见 [验收记录](ENGINE_SERVICES_VALIDATION.md)。

### 协议预设

`0011_protocol_presets` 增加实例共享的 `protocol_presets`，名称唯一，保存 VLESS 非敏感参数及创建时间。创建与审计在同一事务内提交。服务草稿的 `preset_id` 记录模板来源，参数仍是独立快照，保存模板不会创建 Desired 或 Task。详见 [协议预设](PROTOCOL_PRESETS.md)。


## 协议引用与引擎目标（0012）

`engine_targets` 按 engine_id 存储最新目标版本、加密命令、加密凭证快照、非敏感服务引用快照、操作者和安全同步错误。协议配置无版本列；内容摘要用于编辑并发检查。协议更新与变化引擎的目标/不可变 `config_revisions`、desired_revision、审计在同一事务提交。离线目标不创建 Task，这是自动同步与手动发布事务的区别；在线 Gateway 对比已确认版本后才原子创建任务及执行快照。

服务 JSON 显式存储 port_override / sni_override，缺省表示继承。自动应用的 engine_operations.draft_version=-1，不能覆盖或清理用户草稿；已确认应用后重新计算端口保留集合，覆盖草稿、最新目标、执行中和已应用配置。任务终态不直接等同目标终态，旧版本成功不能确认新版本。开发 down 删除 engine_targets；不对历史快照推断继承语义。
