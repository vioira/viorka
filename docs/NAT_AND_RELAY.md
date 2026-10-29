# NAT VPS、端口映射和链路编排

## 1. 为什么 NAT 资源不是布尔值

NAT VPS 可能提供：共享公网 IP、服务商分配的有限公网 TCP 端口、独立内网 IP、受限 UDP、无 QUIC、对外 TCP 连接数限制、IPv6 可直连等。它们是多个能力，不应用 `is_nat` 一项推断。

Viorka 使用三组数据描述：

- `NodeAddress`：公网/内网 IPv4、IPv6、域名，可有多个地址。
- `PortAllocation`：公网 Host:Port 与内网 Host:Port 的 TCP/UDP 映射。
- `NodeCapabilities`（M1 待建）：UDP 是否可用、支持的系统进程管理器、TCP 资源限制、可用引擎、网络功能。

## 2. 端口映射示例

```yaml
# 文档样例，并非当前可导入配置
node: nat-jp-01
addresses:
  private_ipv4: 10.0.0.2
port_allocations:
  - public_host: 203.0.113.10
    public_port: 30001
    private_host: 10.0.0.2
    private_port: 10001
    transport: tcp
    owner: provider
    provider_name: example-provider
```

上面 `203.0.113.10` 为文档示例地址，**不是可用服务器**。用户在面板创建 `10001/TCP` 代理服务时，应使用内网监听 `10001`，对外订阅才使用 `203.0.113.10:30001`。

**映射归属决定操作权限**：

| 归属 | 管理方式 |
|---|---|
| `provider` | 服务商配置；Agent 只能发现/验证，不能擅自增删公网端口 |
| `node` | 用户有 root/network 权限时可通过受控 nftables/iptables 适配器管理 |
| `manual` | 用户手工维护端口对照，Viorka 只读或要求确认后更改 |

## 3. 端口能力检查

发布前应执行：

1. 协议是否支持：节点允许 TCP、UDP 或两者。
2. 公网映射与内网监听端口映射是否匹配。
3. 本地监听端口是否冲突：按 namespace、IP、端口、TCP/UDP 判断。
4. 远端是否确实可达：通过可信探测端执行连接性检查；单纯 `ss -lnt` 不能证明公网映射生效。
5. 如果服务商标称 TCP 并发有限制，不应自动配置大量短连接或强制启用 QUIC。

## 4. 中转链路

示例：

```mermaid
flowchart LR
  Client[客户端\nMihomo / Loon] -->|TCP| Relay[香港 VPS\nRealm TCP Relay]
  Relay -->|TCP| Map[日本 NAT VPS\n公网分配端口]
  Map -->|DNAT| Target[日本 NAT 内网\nXray VLESS + REALITY]
```

### 编排对象

- 入口：哪一节点对客户端暴露 Host/Port；是否通过 NAT 或域名。
- 中转：Realm rule 监听 IP/端口、转发目的端 Host/Port、TCP/UDP 允许性。
- 出口：最终 Xray/sing-box 节点与其内网监听。
- 依赖：先确保出口服务健康，再发布中转，最后更新订阅/展示入口。

### 约束

- TCP 透明转发不应该修改 Reality/TLS payload，`server_name`/public key/short_id 等仍以最终出口引擎为准。
- Relay 不需要持有出口端身份私钥；不要把出口 REALITY 私钥复制给 Relay。
- 使用 NAT 时公私端口可能不同，不可将外网端口直接当目标主机监听端口。
- 对 UDP 受限节点，链路拓扑应显示不可用而不是默默降级为可用。
- 对于端口中转循环（A→B→A）应阻止发布并提示循环路径。

## 5. 资源拓扑与 UI

初始资源图：`Node → Engine → Service → PortAllocation`；M3 新增 `RelayRule(from,to)`。UI 要支持：节点资源列表、地图/拓扑、端口映射表、入口出口角色、连通性探测结果（带测试时间戳）。

## 6. 配置可靠性

1. Orchestrator 计算资源依赖图，检测循环和端口冲突。
2. 按“出口先、入口后”的顺序生成一组 deployment tasks。
3. 每一步有 Revision、幂等键和健康检查，失败后执行有界补偿。
4. 对端口失联、服务商端口变化、节点离线明确告警；不要静默重写业务配置。

## 7. 后续 Provider Adapter

未来可扩展服务商端口映射 API、云防火墙规则和 NAT 对外地址发现。但必须先界定 Provider Credential 的保存、权限最小化和错误回滚，否则默认保持**手工录入/只读同步**。
