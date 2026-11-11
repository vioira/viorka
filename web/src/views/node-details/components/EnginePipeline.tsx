import { useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  canOperateEngine,
  type EngineRecord,
  engineSyncError,
  retryEngineSync,
} from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import { engineDraftChanges } from './engine-draft-diff';

export interface EnginePipelineProps {
  engine: EngineRecord;
  draftVersion: number;
  session: Session;
  online: boolean;
  canEdit: boolean;
  saving: boolean;
  dirty?: boolean;
  onReview: () => void;
  onRefresh: () => Promise<void>;
}

export default function EnginePipeline({
  engine,
  draftVersion,
  session,
  online,
  canEdit,
  saving,
  dirty = false,
  onReview,
  onRefresh,
}: EnginePipelineProps) {
  const { toast } = useToastStack();
  const [retrying, setRetrying] = useState(false);
  const retryLock = useRef(false);

  const unpublished = engineDraftChanges(engine.draft, engine.published_draft).length > 0;
  const isFailed = engine.sync_state === 'failed';
  const isOwnershipConflict = isFailed && engine.sync_error === 'engine_external';
  const confirmed =
    engine.published_draft !== null &&
    engine.published_revision <= engine.observed_revision &&
    !isFailed;
  const isSyncing = engine.sync_state === 'syncing';
  const isPending = engine.sync_state === 'pending';
  const canDeploy = online && canEdit && !saving && !retrying && !dirty && canOperateEngine(engine);

  async function handleRetry() {
    if (retryLock.current || !canDeploy) return;
    retryLock.current = true;
    setRetrying(true);
    try {
      await retryEngineSync(engine.id, session);
      toast({
        id: `sync-${engine.id}`,
        type: 'success',
        title: '已请求重新同步',
        description: online ? '等待 Agent 应用最新目标配置。' : '节点上线后同步最新目标配置。',
      });
      await onRefresh();
    } catch (error) {
      toast({
        id: `sync-${engine.id}`,
        type: 'error',
        title: '未能重试同步',
        description: error instanceof Error ? error.message : '请核对引擎状态后重试。',
      });
    } finally {
      retryLock.current = false;
      setRetrying(false);
    }
  }

  const observedStatus = (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-(--radius-control) bg-surface border-[1px] border-border tabular-nums"
      role={isFailed ? 'button' : undefined}
      tabIndex={isFailed ? 0 : undefined}
      onKeyDown={
        isFailed
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.currentTarget.click();
              }
            }
          : undefined
      }
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${isOwnershipConflict ? 'bg-warning' : isFailed ? 'bg-danger' : isSyncing || isPending ? 'bg-warning' : confirmed ? 'bg-success' : 'bg-text-muted'}`}
      />
      <span className="font-medium">
        {!engine.published_draft
          ? '节点尚无发布配置'
          : confirmed
            ? '发布配置已确认'
            : '发布配置待确认'}
        {isFailed && <span className="sr-only">，同步失败，查看错误详情</span>}
      </span>
    </span>
  );

  return (
    <section
      aria-label="发布流水线"
      className="min-w-0 p-3.5 bg-surface-raised flex flex-wrap items-center justify-between gap-3 text-(length:--text-xs) border-t-[1px] border-border"
    >
      <div className="min-w-0 flex items-center gap-2 flex-wrap" aria-live="polite">
        <span className="font-medium text-text-muted mr-1">配置生命周期</span>
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-(--radius-control) bg-surface border-[1px] border-border tabular-nums">
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${dirty || unpublished ? 'bg-warning' : 'bg-success'}`}
          />
          <span className="font-medium">草稿 v{draftVersion}</span>
          <span className="text-text-muted">
            （{dirty ? '未保存' : unpublished ? '已保存，待发布' : '已保存'}）
          </span>
        </div>
        <span aria-hidden="true" className="text-text-muted select-none">
          →
        </span>
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-(--radius-control) bg-surface border-[1px] border-border tabular-nums">
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${isOwnershipConflict ? 'bg-warning' : isFailed ? 'bg-danger' : isSyncing || isPending ? 'bg-warning' : engine.sync_state === 'synced' ? 'bg-success' : 'bg-text-muted'}`}
          />
          <span className="font-medium">
            {engine.published_draft ? '已发布配置目标' : '尚未发布配置'}
          </span>
        </div>
        <span aria-hidden="true" className="text-text-muted select-none">
          →
        </span>
        {isFailed ? (
          <Tooltip
            openOnClick
            content={
              <span className="block whitespace-pre-wrap wrap-anywhere">
                {engine.sync_error_message || engineSyncError(engine.sync_error ?? '')}
              </span>
            }
          >
            {observedStatus}
          </Tooltip>
        ) : (
          observedStatus
        )}
        {!isFailed && (isSyncing || isPending) && (
          <span
            className={`min-w-0 max-w-full whitespace-pre-wrap wrap-anywhere ml-1 px-2 py-0.5 rounded bg-surface border-[1px] font-medium ${isOwnershipConflict ? 'text-warning border-warning' : isFailed ? 'text-danger border-danger' : isSyncing || isPending ? 'text-warning border-warning' : 'text-text-secondary border-border'}`}
          >
            {isSyncing
              ? '引擎任务执行中'
              : isPending
                ? '目标配置待节点应用'
                : engine.sync_state === 'synced'
                  ? '已发布目标已确认'
                  : engine.sync_state === 'unpublished'
                    ? '尚未发布配置'
                    : '配置发布状态待确认'}
          </span>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {isFailed && (
          <Button
            variant="secondary"
            className="min-h-11 px-2.5 text-(length:--text-xs)"
            disabled={!canDeploy}
            loading={retrying}
            onClick={handleRetry}
          >
            {retrying ? '正在提交' : '重试同步'}
          </Button>
        )}

        <Button
          variant={unpublished ? 'primary' : 'secondary'}
          className="min-h-11 px-3 text-(length:--text-xs)"
          disabled={!canDeploy || (!unpublished && engine.published_draft !== null)}
          onClick={onReview}
        >
          审查并发布
        </Button>
      </div>
    </section>
  );
}
