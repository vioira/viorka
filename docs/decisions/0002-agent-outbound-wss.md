# ADR-0002 Agent 主动 WSS + HTTPS 注册

- 状态：Accepted as design baseline
- 日期：2026-10-29

## 决策

Agent 经 HTTPS 注册后，主动建立一条 WSS 长连接到 Panel（443/TCP），复用心跳、命令、结果与指标。非必要不在 Agent 节点开放管理端口。Panel 前端事件通道单独使用 SSE。

## 理由

适配 NAT VPS、私网节点、UDP 受限环境；不依赖公网直连 Agent，不把业务代理流量送到 Panel。连接有界排队、心跳和退避重连，避免断线风暴。

## 不选

- Panel 主动 SSH 到各节点：需要入站端口、密钥分发和高权限 shell。
- QUIC-only：不适合 UDP 被禁用或严格限速的 NAT VPS。
- 普通 REST 轮询作为主通道：频繁建立连接，任务下发实时性差；后续可做低频 fallback。
