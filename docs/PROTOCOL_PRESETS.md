# VLESS 协议预设

协议配置是实例范围内共享的非敏感参数模板。保存仅创建 SQLite 记录及审计，不创建节点任务，也不生成客户端凭证。

## 当前能力

- “协议配置”菜单提供分页列表和新建页面，名称唯一。
- 仅 VLESS；可保存 XHTTP / TCP (RAW + Vision) / WebSocket、REALITY / TLS、站点目标、SNI、Short ID、客户端指纹、源站证书、CDN 主机名及传输路径。
- TCP 仅可搭配 REALITY，WebSocket 仅可搭配 TLS；自签名源站证书须指定 CDN 主机名。
- Short ID 支持最多 8 个不重复的偶数位十六进制值，每项 2 至 16 位。与参考图不同，留空不在预设内生成共享值，而是在每个服务首次应用时独立生成，沿用现有凭证生命周期。
- 新建页提供非敏感参数摘要。预设没有节点对外地址、UUID 或公钥，不生成可用连接链接，也不宣称订阅格式兼容性。

## 节点引用

当前执行链路仅支持 TCP + REALITY、外部握手目标、Chrome 指纹、自动 Short ID。服务编辑器可以读取预设并填入参数，填写节点监听地址与对外入口后，加入本地草稿、保存共享草稿，再单独应用配置。

引用采用参数快照；`preset_id` 记录来源，不建立自动更新绑定。用户可调整服务参数，既有草稿版本、节点权限和端口检查仍然生效。服务端再次检查引用存在且属于可执行组合；Realm 拒绝 VLESS 预设。保存预设和填入表单均不代表部署成功。

TLS、XHTTP、WebSocket、本节点站点、自定义 Short ID 和非 Chrome 指纹可以保存为预设，但不能引用到现有节点执行链路。自动证书、分组和创建后立即部署尚未接入；本次未修改 Agent 协议或独立 Agent 仓库。

## API 与存储

- `GET /api/v1/protocol-presets`：viewer 及以上可读；`limit` 默认 50、最大 100，`after` 使用响应中的 `next_cursor`，按 ID 升序。满页可能返回游标，最后一次查询可为空。拒绝未知或重复查询参数。
- `POST /api/v1/protocol-presets`：operator / admin 可创建，要求会话、CSRF 和 Origin。成功返回 201；非法参数 400，名称冲突 409。
- 迁移 `0011_protocol_presets` 新增表，配置为非敏感 JSON；名称唯一约束及创建审计在事务内提交。普通列表不包含服务凭证。
- 资源为实例共享预设，节点使用权限仍由既有节点级授权控制。OpenAPI 从路由及 Go 类型生成。

## 验证边界

单元与集成测试覆盖参数组合、Short ID、分页、权限、重复名称、审计、草稿引用与不支持组合拦截。迁移测试包括新增表回滚。真实 Linux/systemd 引擎发布及外部客户端连通不属于本次预设验收，不作成功声明。

## 页面验收记录

- 已按参考站点调整为独立可折叠设置卡片、左侧说明/右侧控件、分段切换、指纹下拉、Short ID 逐项增删、吸附预览和底部创建栏。使用现有 Arc Button/Input/SegmentedControl 与官方新增 Select，业务布局使用 Tailwind；Select 仅增加与 Input 一致的隐藏可视标签能力。
- 真实隔离 SQLite 环境验证创建成功及列表回显，重名时通过全局 Toast 提示并保留输入；键盘操作、390/768/1024/1440px 及浅深主题已检查。未进行屏幕阅读器完整朗读和对比度仪器测量。
- Go 全量测试、race、vet、validate.sh、OpenAPI 生成校验及 Web typecheck/build、改动文件 Biome 均通过。validate.sh 使用临时 Python 虚拟环境安装仓库声明的依赖。
- Web 全量测试为 212 通过、1 失败：未改动的 `web/src/api/telemetry.test.ts:150` 期望 600 个点、实际 120 个；本次未修改遥测逻辑。
