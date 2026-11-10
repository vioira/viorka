import { useEffect, useState } from 'react';
import type { Session } from '@/api/auth';
import { canOperateEngine, type EngineRecord, type EngineService } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { RadioGroup } from '@/components/arc/radio-group/radio-group';
import EngineOperation from './EngineOperation';

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
  const [targetCheck, setTargetCheck] = useState('required');
  useEffect(() => {
    if (!open) setTargetCheck('required');
  }, [open]);
  const activeServices = services.filter((s) => !s.pending_delete);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`审查并发布 ${engine.name}`}
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
              disabled={!online || !canEdit || saving || !canOperateEngine(engine)}
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
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-(length:--text-sm) font-medium">
                服务清单（{activeServices.length} 项）
              </h3>
              <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                草稿 v{engine.draft.version}
              </span>
            </div>
            <div className="rounded-(--radius-control) border-[1px] border-border divide-y divide-border text-(length:--text-xs) max-h-56 overflow-y-auto">
              {activeServices.length === 0 ? (
                <p className="p-3 text-text-muted">当前草稿尚无配置服务。</p>
              ) : (
                activeServices.map((service) => (
                  <div
                    key={service.id}
                    className="p-4 flex items-center justify-between gap-4 bg-surface"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="font-medium text-foreground wrap-anywhere">
                        {service.name || '未命名服务'}
                      </div>
                      <div className="text-(length:--text-xs) text-text-secondary font-mono tabular-nums wrap-anywhere">
                        监听 {service.listen_host}:{service.listen_port}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-(length:--text-xs) font-medium shrink-0 border-[1px] ${
                        service.enabled
                          ? 'bg-surface-raised text-success border-border'
                          : 'bg-surface-raised text-text-muted border-border'
                      }`}
                    >
                      {service.enabled ? '启用' : '停用'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

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
