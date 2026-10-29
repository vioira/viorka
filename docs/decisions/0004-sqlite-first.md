# ADR-0004 SQLite 默认 + PostgreSQL 演进

- 状态：Accepted as design baseline
- 日期：2026-10-29

## 决策

Panel 默认 SQLite + WAL，任务/配置做事务一致性，监控数据先汇总后批量入库。存储访问放适配器边界。需要水平扩容时切换 PostgreSQL，并独立拆 Worker。

## 注意

WAL 仍是单写者模型，不适合用同一数据库文件实现多主 Panel；不能通过把 SQLite 放 NFS 上绕过此限制。
