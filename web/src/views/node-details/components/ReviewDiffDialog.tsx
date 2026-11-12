import { useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { canOperateEngine, type EngineRecord, type EngineService } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { RadioGroup } from '@/components/arc/radio-group/radio-group';
import EngineOperation from './EngineOperation';
import { engineDraftChanges } from './engine-draft-diff';

export interface ReviewDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engine: EngineRecord;
  services: EngineService[];
  session: Session;
  online: boolean;
  canEdit: boolean;
  saving: boolean;
  onDone: () => Promise<void>;
  onApplyAction: (
    key: string,
    allowUnreachable: boolean,
  ) => Promise<{ id?: string; local_only?: boolean }>;
}

export default function ReviewDiffDialog({
  open,
  onOpenChange,
  engine,
  services,
  online,
  canEdit,
  saving,
  onDone,
  onApplyAction,
}: ReviewDiffDialogProps) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const [targetCheck, setTargetCheck] = useState('required');
  useEffect(() => {
    if (!open) setTargetCheck('required');
  }, [open]);
  const changes = engineDraftChanges({ ...engine.draft, services }, engine.published_draft);
  const deletionCount = changes.filter((change) => change.kind === '删除').length;
  const needsTargetCheck =
    engine.name === 'realm' &&
    services.some((service) => service.enabled && !service.pending_delete);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`审查并发布 ${engine.name}`}
        className="[--dialog-width:560px]"
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <EngineOperation
              key={targetCheck}
              title="发布配置"
              variant="primary"
              description={`${deletionCount ? `本次将删除 ${deletionCount} 项配置，删除的服务或规则将不再处理流量。` : ''}发布 ${engine.name} 已保存草稿，可能重启引擎并影响全部服务。保持停止的引擎不会自动启动。`}
              disabled={
                !online ||
                !canEdit ||
                saving ||
                !canOperateEngine(engine) ||
                (changes.length === 0 && engine.published_draft !== null)
              }
              run={(key) => onApplyAction(key, needsTargetCheck && targetCheck === 'allow')}
              onDone={async () => {
                onOpenChange(false);
                await onDone();
              }}
            />
          </>
        }
      >
        <div className="grid min-w-0 gap-6">
          <section aria-label="发布差异" className="min-w-0 space-y-4">
            <p className="text-(length:--text-xs) text-text-secondary">
              {engine.published_draft
                ? deletionCount
                  ? `共 ${changes.length} 项变更，其中删除 ${deletionCount} 项，发布成功后生效。`
                  : `共 ${changes.length} 项变更，对比最近发布目标与已保存草稿。`
                : '首次发布，以下配置将发布到节点。'}
            </p>
            {changes.length === 0 ? (
              <p className="text-(length:--text-sm)">没有配置变更。</p>
            ) : (
              <ul className="divide-y divide-border text-(length:--text-sm)">
                {changes.map((change) => (
                  <li key={change.id} className="min-w-0 space-y-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-baseline justify-between gap-4">
                      <h3 className="min-w-0 font-medium wrap-anywhere">{change.name}</h3>
                      <span className="shrink-0 text-(length:--text-xs) text-text-secondary">
                        {change.kind === '删除' ? '待删除' : change.kind}
                      </span>
                    </div>
                    {change.kind === '修改' && (
                      <div
                        aria-hidden="true"
                        className="hidden grid-cols-2 gap-4 border-b border-border pb-2 text-(length:--text-xs) text-text-secondary sm:grid"
                      >
                        <span>发布前</span>
                        <span>发布后</span>
                      </div>
                    )}
                    <dl className={change.kind === '删除' ? 'space-y-2' : 'space-y-4'}>
                      {change.fields
                        .filter(
                          (field) =>
                            change.kind === '修改' ||
                            (field.label !== '名称' &&
                              (change.kind === '新增' ? field.after : field.before) !== '未设置'),
                        )
                        .map((field) => (
                          <div
                            key={field.label}
                            className={
                              change.kind === '删除'
                                ? 'grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-baseline gap-4'
                                : 'min-w-0 space-y-2'
                            }
                          >
                            <dt className="text-(length:--text-xs) text-text-secondary">
                              {field.label}
                            </dt>
                            {change.kind === '修改' ? (
                              <dd className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-4">
                                <div className="min-w-0 whitespace-pre-wrap wrap-anywhere text-text-secondary">
                                  <span className="mr-2 text-(length:--text-xs) sm:sr-only">
                                    发布前：
                                  </span>
                                  {field.before}
                                </div>
                                <div className="min-w-0 whitespace-pre-wrap font-medium wrap-anywhere">
                                  <span className="mr-2 text-(length:--text-xs) font-normal text-text-secondary sm:sr-only">
                                    发布后：
                                  </span>
                                  {field.after}
                                </div>
                              </dd>
                            ) : (
                              <dd className="min-w-0 whitespace-pre-wrap wrap-anywhere tabular-nums">
                                {change.kind === '新增' ? field.after : field.before}
                              </dd>
                            )}
                          </div>
                        ))}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {needsTargetCheck && (
            <div className="min-w-0 space-y-3">
              <RadioGroup
                label="转发目标检查"
                value={targetCheck}
                onValueChange={setTargetCheck}
                options={[
                  { value: 'required', label: '目标可达时才发布' },
                  {
                    value: 'allow',
                    label: '目标暂不可达时仍发布',
                    description: '目标恢复后才能转发流量。',
                  },
                ]}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
