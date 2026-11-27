import { Save } from 'lucide-react';
import type { OutboundConfig, OutboundPreview } from '@/api/outbounds';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { StatusIndicator } from '@/components/node-status';

export default function OutboundImpactDialog({
  config,
  preview,
  busy,
  onClose,
  onConfirm,
  returnFocus,
}: {
  config: OutboundConfig;
  preview: OutboundPreview;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  returnFocus: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        title="确认修改共享出口"
        description="保存后同步已发布的引用节点，可能重启相关节点的 sing-box。未发布草稿不会自动应用。"
        className="[--dialog-width:600px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              返回编辑
            </Button>
            <Button type="button" disabled={busy} loading={busy} onClick={() => void onConfirm()}>
              <Save size={16} strokeWidth={1.75} aria-hidden="true" />
              保存并同步出口
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-control) border-[1px] border-border bg-background px-3.5 py-2.5 text-(length:--text-xs)">
            <span className="font-medium text-foreground wrap-anywhere">{config.name}</span>
            <span className="font-mono tabular-nums text-text-secondary wrap-anywhere">
              {config.server}:{config.server_port}
            </span>
          </div>

          <section aria-label="受影响节点" className="space-y-2.5">
            <h3 className="text-(length:--text-xs) font-medium text-text-secondary tabular-nums">
              影响范围（{preview.impacts.length} 个节点）
            </h3>
            {preview.impacts.length === 0 ? (
              <p className="rounded-(--radius-control) border-[1px] border-border bg-background px-3.5 py-3 text-(length:--text-xs) text-text-secondary">
                当前没有节点引用此出口，保存后不会触发节点同步。
              </p>
            ) : (
              <ul className="divide-y-[1px] divide-border-subtle overflow-hidden rounded-(--radius-control) border-[1px] border-border">
                {preview.impacts.map((impact) => {
                  const online = impact.state === 'online';
                  const statusLabel = impact.draft_only
                    ? '仅草稿引用，不触发同步'
                    : online
                      ? impact.requires_agent_upgrade
                        ? '升级 Agent 后同步'
                        : '立即自动同步'
                      : '上线后同步最新目标';
                  const tone = impact.draft_only
                    ? 'neutral'
                    : online && !impact.requires_agent_upgrade
                      ? 'success'
                      : 'warning';
                  return (
                    <li
                      key={impact.engine_id}
                      className="flex flex-wrap items-center justify-between gap-2 bg-surface px-3.5 py-2.5 text-(length:--text-xs)"
                    >
                      <StatusIndicator
                        text={impact.node_name}
                        className={
                          online
                            ? 'font-medium text-success wrap-anywhere'
                            : 'font-medium text-text-secondary wrap-anywhere'
                        }
                      />
                      <Badge size="sm" tone={tone}>
                        {statusLabel}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
