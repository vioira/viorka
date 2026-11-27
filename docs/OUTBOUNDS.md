# 共享出口与 sing-box 分流

2026-11-05。内部开发功能，未发布或部署到真实节点。

## 配置与引用

“出口配置”与“协议配置”同级。支持分页列表、手动创建、VLESS 链接解析、编辑、复制及删除。协议范围为 SOCKS5、HTTP CONNECT（可选 TLS、验证证书）和 VLESS TCP（无 TLS 或 REALITY）。出口是实例共享配置；节点草稿仅存出口 ID、规则及默认动作，不允许覆盖出口参数。

链接解析由 Panel 完成，不访问链接目标；接受 VLESS TCP/RAW（security=none、缺省 security 或 security=reality），支持 UUID、服务器、端口、SNI、公钥、Short ID、Flow、指纹及备注名称。导入 3x-ui 的 REALITY 链接时，接受以 / 开头的 spx 路径和布尔标记 support-x25519mlkem768（true 或 false）。这两项只在导入时识别，不写入 sing-box 配置；实际 TLS 指纹沿用 fp。未知参数、重复参数、不支持的传输/安全组合和非法值均拒绝，不静默忽略。解析只填入表单。共享出口导入不支持订阅 URL、批量导入、WebSocket、XHTTP 或出口组。

新建、编辑预览、确认保存和链接导入均校验服务器地址。地址可填主机名、完整的四段十进制 IPv4 或不带方括号的 IPv6，端口单独填写，范围为 1 至 65535。纯数字缩写（如 `188.239.1`）、带前导零的 IPv4 分段和超出 255 的分段会被拒绝。已保存的错误地址仍可打开编辑，需修正后才能再次保存。表单提交时会聚焦首个无效字段，通过全局提示说明格式要求。

密码与 UUID 不在普通读取响应中返回，只返回已设置标记。编辑相同协议时，空 UUID 保留原值；认证用户名非空且密码留空时保留密码，用户名清空则清除密码。复制在服务端创建独立全局配置，不导出凭证。完整配置使用现有独立 engine key 加密，任务与修订沿用加密存储；审计仅记录对象 ID 和动作。

## 分流行为

节点详情的 sing-box 在「代理服务」「共享出口」「分流规则」中共用一份草稿。可按名称、协议或服务器搜索并引用共享出口。引用列表显示默认出口及关联规则，分流页可直接调整默认出口和匹配顺序。节点离线仍可保存草稿，发布由服务端能力与在线状态检查约束。

- 规则按保存顺序执行，首个终结动作命中后停止匹配；支持启停、复制、上下移动和删除。
- 匹配条件：指定服务或全部服务、完整域名、域名后缀、目标 CIDR、目标端口/范围、TCP/UDP。同字段值为或，不同字段为且；Agent 用显式 logical AND 规则避免 sing-box 默认地址条件的或语义。无条件规则必须明确选择“全部流量”。
- 动作：本机直连、引用出口、拒绝连接。HTTP CONNECT 仅允许显式 TCP 规则，不能用于默认出口。
- 默认出口初始为本机直连，也可选择其他支持出口或拒绝。代理失败不会自动降级直连。
- 可选嗅探域名；无法识别的加密流量不保证命中域名规则。有启用的 IP 规则时先通过本地解析器解析目标域名。
- 业务连接和代理服务器域名均使用节点本地解析器，不承诺 DNS 随代理出站。未接入独立 DNS 分流和出口连通性探测，界面明确显示未验证。
- 每引擎最多 32 个引用、128 条规则；每类条件最多 64 值，服务范围最多 32 项。

引用被规则（包括停用规则）或默认出口使用时不能移除。全局删除检查共享草稿、最新发布目标、执行中快照和最后成功配置；必须先移除引用并成功应用，避免断开的执行结果或实际运行配置仍引用被删除对象。

### GeoIP 与 GeoSite

- 分流草稿接受 `geoip`（目标 IP 地理分类）和 `geosite`（目标域名分类）。每个字段最多 64 个小写代码，启用规则合计最多引用 128 个不同的外部规则集。与其他条件相同，同字段任意值命中即可，不同字段须同时命中。匹配全部流量时可限定入站服务。
- 在规则编辑器中点击 GeoSite 或 GeoIP 的目录图标，左栏可搜索和勾选分类，每页 100 项。右栏保留跨搜索、跨页的全部已选项，可逐项移除。确认后回填当前规则，取消保留原值。编辑时会标记已失效的分类，移除或重新选择后可保存。域名、网段、协议和端口通过「添加其他条件」配置。
- 登录后可读取 `GET /api/v1/routing/geo-catalog`。它返回 Panel 编译时嵌入的固定版本目录，每个来源含 `revision`、按代码排序的 `codes` 和 `built_in`。保存草稿时会校验分类是否属于相应来源，未知分类返回 HTTP 400 和 `routing_geo_unknown`。更新 Agent 的规则集版本时，同步修改 `scripts/generate_geo_catalog.py` 中的提交并运行 `python3 scripts/generate_geo_catalog.py`，将生成的两个目录文件与匹配的 Panel 一起交付。
- 大陆直连模板添加独立的 GeoSite `cn` 和 GeoIP `cn` 规则，使任一条件命中即可直连。广告拦截模板使用 GeoSite `category-ads-all`。模板追加到草稿，可用排序控件调整优先级，排在前面的通配规则可能遮挡模板。
- sing-box 1.14.4 使用 rule-set。Agent 为实际参与匹配的规则引用固定版本的 SagerNet 二进制规则集，通过节点直连 HTTPS 从 `raw.githubusercontent.com` 加载。GeoIP `private` 使用内置的非公网 IP 匹配。使用外部规则集时，节点须能访问该来源。域名目标的 GeoIP 匹配使用现有的本地 DNS 解析路径。
- Panel 和 Agent 均须使用 `engine.manage.v8`。草稿仍可离线保存，发布和执行受现有在线能力、节点授权和校验约束。

## 全局修改与同步

编辑先预览受影响节点，确认后保存。并发版本和绑定操作者、配置、引用范围及引擎目标的 MAC 防止过期确认。保存者须有所有引用节点的管理权限；单次最多 500 个引用引擎，超限拒绝。

事务内更新全局出口、各引擎最新目标、期望修订及审计；复用既有目标调和与持久化任务。只更新已发布快照中的该出口，不把未发布服务、引用或分流草稿带入目标。仅草稿引用的节点不产生发布目标。离线修改合并为最新目标，上线后执行；各节点独立确认，保存成功不代表节点生效。

已停止引擎保持停止，同时保留执行中启停操作的意愿。同引擎操作串行。历史恢复恢复节点的规则/引用快照，同时解析当前全局出口与当前有效凭证；不会恢复已更换的共享凭证，已删除引用无法自动复活。

## API、存储及协议

- `GET /api/v1/outbounds`：viewer 及以上；按 ID 升序，limit 默认 50、最大 100，after 游标；返回脱敏配置和引用数。
- `POST /api/v1/outbounds/parse`：operator/admin，解析链接并返回输入者提供的配置，禁止缓存。
- `POST /api/v1/outbounds`：创建。
- `POST /api/v1/outbounds/{id}/preview`、`PUT /api/v1/outbounds/{id}`：影响预览与确认保存。
- `POST /api/v1/outbounds/{id}/copy`：以新名称复制全局配置。
- `DELETE /api/v1/outbounds/{id}`：条件版本删除，仅无引用时允许。
- 写接口使用现有会话、CSRF、Origin 和角色检查；节点操作继续逐资源授权。非法值 400、无权限 403、缺失 404、冲突/过期确认 409；依赖不可用 503。
- `PUT /api/v1/engines/{id}/draft` 增加可选 `routing`，不接收出口参数或凭证；服务端解析全局引用并校验协议约束。OpenAPI 由 Go 路由与 DTO 生成。
- `0014_outbounds` 增加加密出口表及草稿 routing_json，不回填历史业务数据；不自动清理已有数据库。
- 引擎能力升级为 `engine.manage.v3`，Envelope 保持 1.0，REST 保持 v1。v1/v2 Agent 不接受新引擎任务，Panel/Agent 需配套更新。独立 Agent 中同步 Schema、生成模型与校验辅助源码。
- 类型化命令增加 `outbounds` 与 `routing`；示例 `api/agent/v1/examples/engine.egress.json`。Agent 校验并生成 `00-egress.json`，与服务配置作为整组配置校验、切换和回滚。

## 验证记录与边界

- Panel：Go 全量测试、vet、race、validate.sh，生成模型/OpenAPI/Schema、真实临时 SQLite 事务与回滚测试。
- 新增测试覆盖链接解析与拒绝、凭证脱敏/加密、跨节点权限、过期确认、引用删除保护、离线合并、未发布草稿隔离、协议同步保留分流、停止意愿、并发单赢家、已应用引用删除保护和历史恢复读取当前共享配置。
- Agent：Go 全量测试、race、vet、validate.sh 及 Linux amd64/arm64 测试编译。
- 从官方发行下载并核验摘要的 sing-box 1.14.4 macOS arm64 二进制通过实际 `check -C`。可通过 `VIORKA_TEST_SINGBOX=/path/to/sing-box go test ./internal/runtime -run TestSingboxNative -v` 重跑。
- 本地原生流量测试使用隔离 HTTP 入站与 SOCKS 测试服务，验证规则次序、不同字段 AND、代理/直连、代理失效不降级及默认拒绝；不代表真实 VLESS TLS 握手、远端 UDP 或 Linux/systemd 验收。
- Web：typecheck/build、改动文件 Biome 与全量 223 项测试通过。浏览器使用隔离 SQLite 和真实 REST 验证链接导入、复制、引用、分流草稿保存、全局影响预览、成功和失败的 Toast/输入保留、排序与 Escape 焦点返回；检查 390/768/1024/1440px、浅深主题。隔离节点没有真实 Agent；SSE 未纳入该浏览器夹具。
- 尚未运行真实 Linux/systemd 节点发布、外部 VLESS/HTTP TLS/UDP 客户端连通、完整屏幕阅读器与仪器对比度验收。UI 不宣称出口健康，构建仍有既有大 chunk 提示。本次未发布、未部署、未重启用户开发服务。

## 2026-11-06 普通 VLESS TCP

支持手动选择“无 TLS”及解析普通 TCP/RAW 链接。此模式仅使用服务器、端口和 UUID，不允许 SNI、REALITY 公钥、Short ID、指纹或 Flow；REALITY 的校验不变。现有 tls=false/省略字段表示普通 TCP，tls=true 表示 REALITY，没有新增 REST 字段或数据库迁移。独立 Agent 已同步校验；旧 Agent 会拒绝普通 TCP，需要配套升级，本次不发布或部署 Agent。

本次验证：普通 TCP 链接解析、参数拒绝、真实 REST 创建/读取与 UUID 脱敏、双仓库协议校验、Agent 无 TLS 配置渲染；本机 sing-box 1.14.4 原生 check 通过。Web typecheck/build、223 项测试及改动文件 Biome 通过。沿用 Arc Select 与全局 Toast，经代码核查未新增固定宽度或主题颜色；本次未运行浏览器键盘、移动端、浅深主题实测和真实节点业务连通验收。
