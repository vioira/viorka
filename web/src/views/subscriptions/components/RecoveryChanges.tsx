import type { RecoveryChange } from '@/api/subscriptions';
import DataTable from '@/components/data-table';

export default function RecoveryChanges({ changes }: { changes: RecoveryChange[] }) {
  return (
    <DataTable
      caption="配置差异"
      rows={changes.map((change) => ({ ...change, id: `${change.resource}:${change.field}` }))}
      rowKey="id"
      emptyMessage="没有字段变化"
      columns={[
        { key: 'resource', label: '对象', sortable: false },
        { key: 'field', label: '字段', sortable: false },
        ...(['before', 'after'] as const).map((key) => ({
          key,
          label: key === 'before' ? '面板记录' : '节点当前配置',
          sortable: false,
          render: (value: unknown) => (
            <span className="whitespace-pre-wrap break-all">{String(value) || '未设置'}</span>
          ),
        })),
      ]}
    />
  );
}
