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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`审查并发布 ${engine.name}`}
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
              description={`发布 ${engine.name} 已保存草稿，可能重启引擎并影响全部服务。保持停止的引擎不会自动启动。`}
              disabled={
                !online ||
                !canEdit ||
                saving ||
                !canOperateEngine(engine) ||
                (changes.length === 0 && engine.published_draft !== null)
              }
              run={(key) => onApplyAction(key, engine.name === 'realm' && targetCheck === 'allow')}
              onDone={async () => {
                onOpenChange(false);
                await onDone();
              }}
            />
          </>
        }
      >
        <div className="grid gap-6 p-1 sm:p-2">
          <section aria-label="发布差异" className="min-w-0 space-y-4">
            <p className="text-(length:--text-xs) text-text-secondary">
              {engine.published_draft ? '对比最近发布目标与当前已保存草稿。' : '首次发布配置。'}
            </p>
            {changes.length === 0 ? (
              <p className="text-(length:--text-sm)">没有配置变更。</p>
            ) : (
              <ul className="divide-y divide-border text-(length:--text-sm)">
                {changes.map((change) => (
                  <li key={change.id} className="min-w-0 py-4 space-y-3">
                    <h3 className="font-medium wrap-anywhere">
                      {change.kind} {change.name}
                    </h3>
                    <dl className="space-y-3 text-(length:--text-xs)">
                      {change.fields
                        .filter(
                          (field) =>
                            change.kind === '修改' ||
                            (field.label !== '名称' &&
                              (change.kind === '新增' ? field.after : field.before) !== '未设置'),
                        )
                        .map((field) => (
                          <div key={field.label} className="min-w-0 space-y-1">
                            <dt className="font-medium">{field.label}</dt>
                            {change.kind === '修改' ? (
                              <>
                                <dd className="wrap-anywhere text-text-secondary">
                                  发布前：{field.before}
                                </dd>
                                <dd className="wrap-anywhere">发布后：{field.after}</dd>
                              </>
                            ) : (
                              <dd className="wrap-anywhere text-text-secondary">
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

          {engine.name === 'realm' && (
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
