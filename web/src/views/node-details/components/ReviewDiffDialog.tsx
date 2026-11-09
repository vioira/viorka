import type { Session } from '@/api/auth';
import type { EngineRecord, EngineService } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
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
  onApplyAction: (key: string) => Promise<{ id?: string; local_only?: boolean }>;
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
  const activeServices = services.filter((s) => !s.pending_delete);
  const nextRevision = Math.max(engine.desired_revision, engine.observed_revision + 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`审查变更并发布到 ${engine.name}`}
        description="核对即将推送到节点的配置内容。应用后将原子更新节点配置并重载引擎进程。"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              关闭审查
            </Button>
            <EngineOperation
              title="立即应用到节点"
              variant="primary"
              description={`将已保存草稿应用到 ${engine.name} 的全部 ${activeServices.length} 项配置，可能重启共享进程。保持停止时不会自动启动。`}
              disabled={!online || !canEdit || saving}
              run={onApplyAction}
              onDone={async () => {
                onOpenChange(false);
                await onDone();
              }}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {/* Revision Banner */}
          <div className="flex items-center justify-between p-2.5 rounded-(--radius-control) bg-surface-raised border-[1px] border-border text-(length:--text-xs)">
            <div className="flex items-center gap-2">
              <span className="text-text-muted">修订推进:</span>
              <span className="font-mono font-medium text-text-secondary tabular-nums">
                r{engine.observed_revision}
              </span>
              <span className="text-accent select-none">→</span>
              <span className="font-mono font-medium text-success tabular-nums">
                r{nextRevision} (最新)
              </span>
            </div>
            <span className="text-(length:--text-xs) font-medium px-1.5 py-0.5 rounded bg-surface border-[1px] border-border tabular-nums text-text-secondary">
              草稿 v{engine.draft.version}
            </span>
          </div>

          {/* Service Diff Summary */}
          <div className="space-y-2">
            <span className="text-(length:--text-xs) font-medium text-text-muted uppercase tracking-wider">
              服务配置清单 ({activeServices.length} 项)
            </span>
            <div className="rounded-(--radius-control) border-[1px] border-border divide-y divide-border text-(length:--text-xs) max-h-56 overflow-y-auto">
              {activeServices.length === 0 ? (
                <p className="p-3 text-text-muted">当前草稿尚无配置服务。</p>
              ) : (
                activeServices.map((service) => (
                  <div
                    key={service.id}
                    className="p-2.5 flex items-center justify-between gap-3 bg-surface"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-text-primary truncate">
                        {service.name || '未命名服务'}
                      </div>
                      <div className="text-(length:--text-xs) text-text-muted font-mono tabular-nums truncate">
                        监听 {service.listen_host}:{service.listen_port}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-(length:--text-xs) font-medium shrink-0 border-[1px] ${
                        service.enabled
                          ? 'bg-surface-raised text-success border-success/30'
                          : 'bg-surface-raised text-text-muted border-border'
                      }`}
                    >
                      {service.enabled ? '启用运行' : '停用'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Preflight Notice */}
          <div className="p-3 rounded-(--radius-control) bg-surface-raised border-[1px] border-border text-(length:--text-xs) text-text-secondary">
            <p className="font-medium text-text-primary mb-0.5">Agent 本地预检就绪</p>
            <p>
              配置下发后，Agent
              将在本地自动校验端口冲突与语法。若校验失败将自动回滚至上一有效配置，保障节点连通性。
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
