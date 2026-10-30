import { Button } from '@/components/arc/button/button';
import { EmptyState } from '@/components/arc/empty-state/empty-state';
import {
  SortableDataTable,
  type SortableDataTableProps,
} from '@/components/arc/sortable-data-table/sortable-data-table';

export type { DataColumn } from '@/components/arc/sortable-data-table/sortable-data-table';

export type DataTableProps<T extends Record<string, unknown>> = SortableDataTableProps<T> & {
  loading?: boolean;
  tableClassName?: string;
  error?: string;
  onRetry?: () => void;
};

/** Shared table boundary: Arc owns sorting, keyboard access and responsive rows. */
export default function DataTable<T extends Record<string, unknown>>({
  loading = false,
  tableClassName,
  error,
  onRetry,
  caption = '数据列表',
  emptyMessage = '暂无数据',
  ...props
}: DataTableProps<T>) {
  return (
    <div className="min-w-0" aria-busy={loading}>
      {error ? (
        <div role="alert">
          <EmptyState
            title="列表加载失败"
            description={error}
            action={
              onRetry ? (
                <Button variant="secondary" onClick={onRetry}>
                  重新加载
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : loading ? (
        <div role="status" className="space-y-4 py-6">
          <p className="text-text-secondary">正在加载{caption}…</p>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              aria-hidden="true"
              className="h-12 rounded-(--radius-control) bg-surface-muted"
            />
          ))}
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto">
          <div className={tableClassName}>
            <SortableDataTable {...props} caption={caption} emptyMessage={emptyMessage} />
          </div>
        </div>
      )}
    </div>
  );
}
