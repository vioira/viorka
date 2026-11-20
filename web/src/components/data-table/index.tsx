import { useEffect, useEffectEvent, useId } from 'react';
import {
  SortableDataTable,
  type SortableDataTableProps,
} from '@/components/arc/sortable-data-table/sortable-data-table';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EmptyStates, { type EmptyStatesProps } from '@/components/empty-states';

export type { DataColumn } from '@/components/arc/sortable-data-table/sortable-data-table';

export type DataTableProps<T extends Record<string, unknown>> = Omit<
  SortableDataTableProps<T>,
  'busy' | 'emptyContent' | 'showSkeleton'
> & {
  loading?: boolean;
  loaded?: boolean;
  emptyState?: Omit<EmptyStatesProps, 'title'>;
  unknownMessage?: string;
  error?: string;
  onRetry?: () => void;
};

/** Shared table boundary: Arc owns sorting, keyboard access and responsive rows. */
export default function DataTable<T extends Record<string, unknown>>({
  loading = false,
  loaded,
  emptyState,
  unknownMessage,
  error,
  onRetry,
  caption = '数据列表',
  emptyMessage = '暂无数据',
  ...props
}: DataTableProps<T>) {
  const hasResult = loaded ?? (!loading && !error);
  const showSkeleton = loading && !hasResult && props.rows.length === 0;
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
    <div className="min-w-0">
      <span className="sr-only" role="status">
        {loading ? `正在${showSkeleton ? '加载' : '刷新'}${caption}` : ''}
      </span>
      <SortableDataTable
        {...props}
        caption={caption}
        showSkeleton={showSkeleton}
        busy={loading}
        emptyContent={
          <EmptyStates
            headingLevel={3}
            compact
            {...(hasResult ? emptyState : { variant: 'unknown' })}
            title={hasResult ? emptyMessage : (unknownMessage ?? `${caption}尚未读取`)}
          />
        }
      />
    </div>
  );
}
