# ADR-0003 声明式状态 + 幂等任务

- 状态：Accepted as design baseline
- 日期：2026-10-29

## 决策

Panel 保存不可变 ConfigRevision 和 Desired State；Task 记录持久化后派发；Agent 根据 Idempotency Key 去重并回传 Observed State；实际成功必须经过引擎健康检查。故障时尽力恢复上次成功版本，回滚失败则报告 degraded。

## 理由

跨 NAT 长连接不可靠，任务至少一次投递更现实；控制平面暂时离线不应停止已启动的代理服务。

## 约束

不保证绝对零中断、不保证网络 exactly-once；不要把一个 WebSocket 发送完成等同于执行成功。
