// UI fixtures from docs/design.html. No server operations are performed.
export type AuditRecord = {
  id: string;
  kind: 'user' | 'system';
  actor: string;
  action: string;
  target: string;
  ip: string;
  time: string;
};

export const mockAudits: AuditRecord[] = [
  {
    actor: 'Jonathan',
    action: '创建注册令牌',
    target: '节点 jp-nat-02',
    time: '2026-10-29T22:12:00Z',
    ip: '203.0.113.8',
    id: 'audit-1',
    kind: 'user',
  },
  {
    actor: 'Jonathan',
    action: '发布配置修订',
    target: 'jp-nat-01 / r42（待发布）',
    time: '2026-10-29T22:58:00Z',
    ip: '203.0.113.8',
    id: 'audit-2',
    kind: 'user',
  },
  {
    actor: '系统',
    action: '节点离线告警',
    target: 'de-fra-01 心跳超时',
    time: '2026-10-29T22:31:00Z',
    ip: '不适用',
    id: 'audit-3',
    kind: 'system',
  },
  {
    actor: 'Jonathan',
    action: '吊销订阅凭证',
    target: '旧订阅链接（2026-09 生成）',
    time: '2026-10-29T14:40:00Z',
    ip: '203.0.113.8',
    id: 'audit-4',
    kind: 'user',
  },
  {
    actor: 'operator-lin',
    action: '只读检查',
    target: 'hk-relay-01 node.inspect',
    time: '2026-10-29T11:15:00Z',
    ip: '203.0.113.19',
    id: 'audit-5',
    kind: 'user',
  },
  {
    actor: 'Jonathan',
    action: '接管引擎为托管模式',
    target: 'us-sea-01 / Xray',
    time: '2026-10-29T07:02:00Z',
    ip: '203.0.113.8',
    id: 'audit-6',
    kind: 'user',
  },
  {
    actor: '系统',
    action: '数据库备份',
    target: 'viorka.db 每日快照',
    time: '2026-10-28T19:00:00Z',
    ip: '不适用',
    id: 'audit-7',
    kind: 'system',
  },
];
