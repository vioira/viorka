import { useEffect, useEffectEvent, useId } from 'react';
import { Skeleton } from '@/components/arc/skeleton/skeleton';
import {
  SortableDataTable,
  type SortableDataTableProps,
} from '@/components/arc/sortable-data-table/sortable-data-table';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EmptyStates, { type EmptyStatesProps } from '@/components/empty-states';

export type { DataColumn } from '@/components/arc/sortable-data-table/sortable-data-table';

export type DataTableProps<T extends Record<string, unknown>> = SortableDataTableProps<T> & {
  loading?: boolean;
  loaded?: boolean;
  emptyState?: Omit<EmptyStatesProps, 'title'>;
  tableClassName?: string;
  error?: string;
  onRetry?: () => void;
};

/** Shared table boundary: Arc owns sorting, keyboard access and responsive rows. */
export default function DataTable<T extends Record<string, unknown>>({
  loading = false,
  loaded = true,
  emptyState,
  tableClassName,
  error,
  onRetry,
  caption = '数据列表',
  emptyMessage = '暂无数据',
  ...props
}: DataTableProps<T>) {
  const id = useId();
  const { toast, dismiss } = useToastStack();
  const retry = useEffectEvent(() => onRetry?.());
  const canRetry = !!onRetry;
  useEffect(() => {
    if (error)
      toast({
        id,
        type: 'error',
        title: `${caption}加载失败`,
        description: error,
        action: canRetry ? { label: '重新加载', onClick: () => retry() } : undefined,
      });
    else dismiss(id);
  }, [id, error, caption, canRetry, toast, dismiss]);
  return (
    <div className="min-w-0" aria-busy={loading}>
      {loading && props.rows.length === 0 ? (
        <Skeleton label={`正在加载${caption}`} lines={3} className="py-6" />
      ) : props.rows.length === 0 ? (
        <EmptyStates
          {...emptyState}
          variant={!loaded || error ? 'unknown' : emptyState?.variant}
          title={!loaded || error ? `${caption}尚未读取` : emptyMessage}
        />
      ) : (
        <div className="max-w-full overflow-x-auto">
          <div className={tableClassName}>
            <SortableDataTable
              {...props}
              caption={caption}
              emptyMessage={error ? '尚未读取数据' : emptyMessage}
            />
          </div>
        </div>
      )}
    </div>
  );
}
