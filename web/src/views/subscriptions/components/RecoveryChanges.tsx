import type { RecoveryChange } from '@/api/subscriptions';
import DataTable from '@/components/data-table';

export default function RecoveryChanges({ changes }: { changes: RecoveryChange[] }) {
  return (
    <div className="min-w-0">
      {/* Desktop / Tablet 4-column diff table */}
      <div className="hidden sm:block">
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
                <span
                  className={`whitespace-pre-wrap break-all font-mono text-(length:--text-xs) ${
                    key === 'after' ? 'font-medium text-accent' : ''
                  }`}
                >
                  {String(value) || '未设置'}
                </span>
              ),
            })),
          ]}
        />
      </div>

      {/* Mobile per-field comparison blocks */}
      <div className="sm:hidden">
        {changes.length === 0 ? (
          <p className="rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/40 px-3.5 py-3 text-(length:--text-xs) text-text-secondary">
            没有字段变化
          </p>
        ) : (
          <section className="space-y-2.5" aria-label="配置差异">
            {changes.map((change) => (
              <div
                key={`${change.resource}:${change.field}`}
                className="space-y-2 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/40 p-3 text-(length:--text-xs)"
              >
                <div className="font-medium text-foreground wrap-anywhere">
                  {change.resource} / <span className="font-mono">{change.field}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="min-w-0 rounded-lg border-[1px] border-border-subtle bg-surface p-2">
                    <p className="text-text-secondary">面板记录</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-all font-mono text-foreground">
                      {change.before || '未设置'}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-lg border-[1px] border-(--table-row-selected-border) bg-(--accent-subtle) p-2">
                    <p className="text-text-secondary">节点当前配置</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-all font-mono font-medium text-foreground">
                      {change.after || '未设置'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
