# Viorka 控制平面安全设计

> 本文是安全要求基线，**当前脚手架没有登录鉴权**，只能本机开发运行，绝不可把设计要求误当成已实现的安全能力。

## 1. 威胁边界

```text
Browser (Untrusted) --HTTPS--> Web/API [Auth + RBAC]
Agent (Untrusted network) --TLS WSS--> Agent Gateway [Node identity + task policy]
Agent privileged runtime --local, restricted--> proxy engine / service manager
User proxy traffic ---------------------------> proxy engine (not Panel)
```

主要风险：假冒 Agent 接入、注册令牌泄漏、管理账号盗用、敏感代理配置外泄、任务重放、任意 shell 执行、供应链更新被替换、接管现有服务导致宕机、服务商端口映射误操作。

## 2. 用户身份与 API

- 密码哈希采用成熟现代方案（Argon2id 等），不要自实现密码算法；支持将来 OIDC/Passkey。
- Session 使用 `HttpOnly` + `Secure` + 合理的 `SameSite` Cookie；涉及 Cookie 身份的可变更请求须额外防 CSRF。
- API 默认拒绝跨域来源；CORS allowlist 精准限定，不使用带凭证的 `*`。
- 基础 RBAC：viewer 只读、operator 限定节点操作、admin 管身份和密钥。以后再引入细粒度作用域。
- 敏感操作（删除节点、批量发布、证书/密钥轮换）审计 + 二次确认/重认证。

## 3. Agent 身份

- 一次性 Enrollment Token：短期有效、单次消费、可撤销、日志绝不记录明文。
- Agent 自生成 Ed25519 私钥，权限 0600 或系统 keyring；`agent_credentials` 保存公钥和吊销状态。
- 会话通过 challenge-response 验证私钥持有，并建立短期访问凭证；不能只使用 `node_id` 字符串鉴权。
- WSS 必须使用有效 TLS、主机名校验；反向代理需保护认证头，不允许在日志写 Bearer Token。
- 密钥被吊销的 Agent 必须立即拒绝新会话，已有会话需断开或在短期内过期。

## 4. Agent 最小权限

- 按任务类型（安装/更新引擎、写指定配置目录、启动服务、检查状态）分离执行能力。
- 优先采用 root 守护程序的窄范围内部 API 或最小权限 helper，而不是直接拼接 `sh -c`。
- 文件路径必须在允许的根目录，防 symlink 逃逸；对目标文件采用原子写入、权限设置、所有者校验。
- 禁止服务器端将任意字符拼为 `systemctl ...` / `curl ... | sh` 命令；若确需执行外部进程，使用明确 argv 和绝对路径，超时限流。
- 已有 3x-ui/Xray/sing-box 等服务一律先观察，明确用户授权后才能转换为 managed。
- Agent 不能因 Panel 失联而自动停止现有代理或清空最后成功配置。

## 5. 密钥/代理配置

- 配置历史可能包含 Reality 私钥、UUID、Shadowsocks 密码和证书，必须在数据库字段层加密并设置读取权限。
- 仅向负责该资源的目标 Agent 分发必要 secret；不要在所有节点/订阅中泄漏不相关密钥。
- 对外订阅 URL 使用独立访问凭证，支持轮换/撤销、限制缓存和访问日志脱敏。
- 密钥不出现在指标、审计摘要、HTTP query string、Git 或 UI 的非授权视图里。

## 6. 更新/供应链

- Agent 更新过程检查下载 URL、包哈希、制品签名和目标 CPU 架构，失败恢复旧版本。
- CI 产出 SBOM、依赖漏洞扫描报告和签名；避免将 Agent 装载成任意远端执行器。
- 所有安装脚本都应可审计、固定版本、幂等；禁止默认跳过 TLS 校验。

## 7. 测试清单

- 假冒/撤销 Agent 身份不可连接；nonce 不可重放。
- 旧任务重复投递不会重启/覆盖多次；未知任务操作被拒绝。
- 非管理员不能分发跨节点的任务；用户操作有审计记录。
- 路径穿越/符号链接不能写到指定配置目录之外。
- 代理私钥不会出现在任务日志、SSE 事件、metrics 或错误堆栈中。
- Panel 故障、Agent 断网时已有代理进程不被停止。

当前安全验收状态：**未开始**。公开开放 Panel 端口之前必须完成 M0/M1 的鉴权与边界测试。
