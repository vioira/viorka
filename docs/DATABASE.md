# 数据库模型与迁移计划

> M0 已接入 SQLite 驱动和事务迁移，`0001` 包含节点及其注册令牌字段，`0002` 增加会话、挑战和任务租约。只有认证、连接和只读任务已接业务，代理配置相关表仍是后续阶段模型。见 [GETTING_STARTED.md](GETTING_STARTED.md)。

## 1. 默认 SQLite，后续 PostgreSQL

- v1 默认 SQLite，推荐 WAL 模式，`busy_timeout`、短事务、单机唯一写节点、定期备份与完整性检查。
- 不要在 NFS 或多主机网络文件系统上共享运行中的 SQLite 数据文件。
- 任务与配置发布在同一 DB 事务内完成；调度器只从已提交的数据中读取。
- Raw metrics 不逐点入库：实时保存在有限缓存，持久化 `metric_rollups`，按保留策略清理。
- 数据访问必须放在 `internal/storage` 的抽象边界；需要 PostgreSQL 时使用独立 dialect/migrations，不假定现有 SQLite SQL 原样可直接用于 PG。

## 2. 核心实体

| 实体 | 主键 | 关联和关键字段 | 行为 |
|---|---|---|---|
| `users` | UUID 文本 | username、password_hash、role | 面板用户与 RBAC |
| `nodes` | UUID 文本 | kind、name、state、os/arch、last_seen | 所有 VPS/NAT/Relay 节点 |
| `agent_credentials` | UUID 文本 | node_id、public_key、status | 节点身份和吊销 |
| `node_addresses` | UUID 文本 | node_id、kind、address | 一个节点多个 IPv4/IPv6/域名 |
| `port_allocations` | UUID 文本 | node_id、公私地址/端口、transport、owner | NAT 提供商/本机端口资源 |
| `engines` | UUID 文本 | node_id、name、version、ownership | 每种核心一个默认实例 |
| `proxy_services` | UUID 文本 | node_id、engine_id、listen、config | 本地代理服务（入站等） |
| `relay_rules` | UUID 文本 | source/destination 节点、listen、target | TCP/UDP 中转关系 |
| `config_revisions` | UUID 文本 | node/resource/revision/sha256/desired_json | 不可变配置期望快照 |
| `deployments` | UUID 文本 | desired_revision、observed_revision、status | 实际是否达到期望 |
| `tasks` | UUID 文本 | node、idempotency_key、attempt、state、payload | 持久化任务与重试 |
| `metric_rollups` | 组合键 | node、bucket_start、period_seconds | 汇总监控指标 |
| `audit_logs` | UUID 文本 | actor、action、resource、summary | 可追责操作审计 |

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

## 每节点采集设置迁移（0005）

`nodes` 新增 `settings_revision`、`collection_seconds`（默认 30）、`report_seconds`（默认 300）、`connection_mode`（仅 `wss`）、`wss_report_seconds`（默认 30）。迁移保留旧节点和资产；数据库与应用共同限制数值范围，WSS 上报不能快于采集。配置修改与审计同事务，Revision 条件更新防止覆盖他人修改。

设置通过节点详情的独立表单维护，不增加节点列表列。GET `/api/v1/nodes/{id}/settings` 允许 viewer 及以上读取；PUT 仅 admin，要求 CSRF 与当前 Revision。保存后断开该节点管理会话，让其自动重连；不操作代理进程。离线节点下次连接读取，旧 Agent 需升级才能使用。保存成功表示已落库，不是 Agent 已应用确认。

## 分钟指标迁移（0006）

`0006_metric_history` 保留已有迁移文件，在迁移前使用现有自动备份。旧采集设置范围和 `report_seconds` 的资产刷新语义不适用于新方案，因此统一重置为 0/60/2 秒并递增 revision；节点、资产和任务保留。资产每 300 秒独立刷新。开发 down 会删除新增统计列并恢复旧设置默认值，不能恢复新指标历史；需要恢复原配置时使用迁移前备份。

`metric_rollups` 仍按 `(node_id,bucket_start,period_seconds)` 唯一，当前写入 period=60。新增 `stats_json` 保存固定指标的 sum/max/count，`last_sample_at` 保存桶内最后采样时间。没有有效样本的指标省略，表示未知，不写零；旧列保留以保持迁移兼容，不承载新统计。新增 bucket_start 索引用于过期清理。

每节点按 30–180 秒周期提交完整分钟桶快照，每批最多 512 行，一个短事务原子写入；发生错误向上返回并有限速退避重试，缓存只保留最近 10 分钟（采样时间允许最多 5 分钟偏差），到期仍未写入的桶丢弃并记录日志。重复提交不会重复累加。启动恢复近期桶及采样水位，避免重启后覆盖同一分钟的已有统计。单 Panel 进程拥有聚合状态，不支持多实例并发写入该状态。

历史查询限制最近 7 天；后台每分钟删除最多 2000 条过期记录，物理清理有延迟，长时间停机产生积压时逐批追赶。50 个节点连续运行 7 天为 504000 条分钟记录（不含清理延迟）。不建立小时表。小时级查询通过 sum/count 合并样本均值、max 合并采样峰值，不插值缺失时间，不做流量计费。
