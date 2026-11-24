import { useState } from 'react';
import { type AlertConfig, type AlertRule, metricLabels } from '@/api/alerts';
import { Button } from '@/components/arc/button/button';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Switch } from '@/components/arc/switch/switch';
import DataTable from '@/components/data-table';

import { ruleCondition } from './rule-condition';

const groups = [
  { value: 'all', label: '全部' },
  { value: 'resource', label: '资源使用' },
  { value: 'network', label: '流量网速' },
  { value: 'offline', label: '节点离线' },
];
export default function RuleList({
  config,
  disabled,
  onToggle,
  onEdit,
  onStatus,
  onDelete,
}: {
  config: AlertConfig;
  disabled: boolean;
  onToggle: (rule: AlertRule) => void;
  onEdit: (rule: AlertRule) => void;
  onStatus: (rule: AlertRule) => void;
  onDelete: (rule: AlertRule) => void;
}) {
  const [filter, setFilter] = useState('all');
  const category = (r: AlertRule) =>
    r.metric === 'offline'
      ? 'offline'
      : ['upload', 'download', 'monthly'].includes(r.metric)
        ? 'network'
        : 'resource';
  const counts = new Map<string, number>();
  for (const r of config.rules) {
    const key = category(r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const options = groups.map((g) => ({
    ...g,
    label: `${g.label} (${g.value === 'all' ? config.rules.length : (counts.get(g.value) ?? 0)})`,
  }));
  const rows = config.rules
    .filter((r) => filter === 'all' || category(r) === filter)
    .map((rule) => ({ id: rule.id, rule }));
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            label="筛选监控项"
            options={options}
            value={filter}
            onValueChange={setFilter}
          />
        </div>
      </div>
      {rows.length > 0 && (
        <ul aria-label="告警规则" className="space-y-3 md:hidden">
          {rows.map(({ rule }) => (
            <li
              key={rule.id}
              className="space-y-3 rounded-(--radius-panel) border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-all font-medium text-foreground">{rule.name}</h3>
                  <p>
                    {metricLabels[rule.metric]}
                    {rule.id === 'node-offline' ? '（系统内置）' : ''}
                  </p>
                </div>
                <Switch
                  aria-label={`启用${rule.name}`}
                  disabled={disabled}
                  checked={rule.enabled}
                  onCheckedChange={(enabled) => onToggle({ ...rule, enabled })}
                />
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt>触发条件</dt>
                <dd>{ruleCondition(rule)}</dd>
                <dt>节点范围</dt>
                <dd>
                  {rule.nodes.length
                    ? `指定 ${rule.nodes.length} 台节点`
                    : '全部节点（含后续新增）'}
                </dd>
                <dt>推送目标</dt>
                <dd className="break-all">
                  {[
                    '站内通知',
                    ...config.channels
                      .filter((ch) => rule.channels.includes(ch.id))
                      .map((ch) => ch.name),
                  ].join('、')}
                </dd>
                <dt>重复提醒</dt>
                <dd>{rule.repeat_minutes ? `每 ${rule.repeat_minutes} 分钟` : '仅提醒一次'}</dd>
              </dl>
              <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onStatus(rule)}
                >
                  查看状态
                </Button>
                <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onEdit(rule)}>
                  编辑
                </Button>
                {rule.id !== 'node-offline' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => onDelete(rule)}
                  >
                    删除
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="v-card">
        <DataTable
          caption="告警规则"
          rows={rows}
          rowKey="id"
          minWidth={920}
          emptyMessage={filter === 'all' ? '尚未添加规则' : '此分类暂无规则'}
          columns={[
            {
              sortable: false,
              key: 'name',
              label: '规则名称',
              render: (_, { rule: r }) => (
                <div className="space-y-1 break-all">
                  <strong className="font-medium">{r.name}</strong>
                  <p className="text-text-secondary">
                    {metricLabels[r.metric]}
                    {r.id === 'node-offline' ? '（系统内置）' : ''}
                  </p>
                </div>
              ),
            },
            {
              sortable: false,
              key: 'enabled',
              label: '启用',
              render: (_, { rule: r }) => (
                <Switch
                  checked={r.enabled}
                  disabled={disabled}
                  aria-label={`启用${r.name}`}
                  onCheckedChange={(enabled) => onToggle({ ...r, enabled })}
                />
              ),
            },
            {
              sortable: false,
              key: 'condition',
              label: '触发条件',
              render: (_, { rule }) => ruleCondition(rule),
            },
            {
              sortable: false,
              key: 'scope',
              label: '服务器范围',
              render: (_, { rule }) =>
                rule.nodes.length ? `${rule.nodes.length} 台服务器` : '全部节点（含后续新增）',
            },
            {
              sortable: false,
              key: 'channels',
              label: '推送目标',
              render: (_, { rule }) => (
                <span className="break-all">
                  {[
                    '站内通知',
                    ...config.channels
                      .filter((ch) => rule.channels.includes(ch.id))
                      .map((ch) => ch.name),
                  ].join('、')}
                </span>
              ),
            },
            {
              sortable: false,
              key: 'repeat',
              label: '重复提醒',
              render: (_, { rule }) =>
                rule.repeat_minutes ? `每 ${rule.repeat_minutes} 分钟` : '仅提醒一次',
            },
            {
              sortable: false,
              key: 'actions',
              label: '操作',
              render: (_, { rule }) => (
                <div className="flex flex-wrap gap-1">
                  <Button variant="ghost" disabled={disabled} onClick={() => onStatus(rule)}>
                    查看状态
                  </Button>
                  <Button variant="ghost" disabled={disabled} onClick={() => onEdit(rule)}>
                    编辑
                  </Button>
                  {rule.id !== 'node-offline' && (
                    <Button variant="ghost" disabled={disabled} onClick={() => onDelete(rule)}>
                      删除
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>
    </section>
  );
}
