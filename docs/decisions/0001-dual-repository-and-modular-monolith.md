# ADR-0001 双仓库 + 模块化单体

- 状态：Accepted as design baseline
- 日期：2026-10-29

## 背景

Viorka 的管理面板与每台 VPS 上的 Agent 有不同的发布周期、权限和故障域；两者需要独立构建、版本兼容。起步阶段若将 API、Gateway、Worker 都独立部署，会提升自建成本。

## 决策

- 两个代码仓库：`viorka`（Go API + React Web）、`viorka-agent`（Go Agent）。
- Panel 初期一个模块化 Go 进程，内部清晰模块边界。
- 使用统一 Agent wire protocol，不直接共享彼此内部 package。
- v2 仅在指标触发时拆 Worker/Gateway。

## 影响

优点：独立升级 Agent、单机易部署、跨仓库责任明确。代价：跨仓库协议协作和合约测试成本，后续拆进程需要持续保持清晰依赖。
