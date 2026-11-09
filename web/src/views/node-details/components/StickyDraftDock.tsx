import { useEffect, useState } from 'react';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';

export interface StickyDraftDockProps {
  dirty: boolean;
  saving: boolean;
  targetVersion: number;
  changesCount: number;
  onSave: () => Promise<void>;
  onDiscard: () => void;
}

export default function StickyDraftDock({
  dirty,
  saving,
  targetVersion,
  changesCount,
  onSave,
  onDiscard,
}: StickyDraftDockProps) {
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  // Keyboard shortcut: Cmd/Ctrl + S to trigger Save Draft
  useEffect(() => {
    if (!dirty) return;

    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!saving) {
          void onSave();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dirty, saving, onSave]);

  if (!dirty) return null;

  return (
    <aside
      aria-label="草稿未保存提示"
      className="fixed bottom-5 inset-x-0 mx-auto max-w-2xl px-4 z-40 transition-all"
    >
      <div className="bg-surface border-[1px] border-warning rounded-(--radius-panel) p-3.5 shadow-floating flex flex-wrap items-center justify-between gap-4">
        {/* Left Info */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-warning shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-(length:--text-sm)">本地有未保存修改</span>
              <span className="text-(length:--text-xs) font-mono px-1.5 py-0.2 rounded bg-surface-raised border-[1px] border-border tabular-nums text-text-secondary">
                草稿将递增至 v{targetVersion}
              </span>
            </div>
            <p className="text-(length:--text-xs) text-text-secondary truncate">
              {changesCount > 0
                ? `共检测到 ${changesCount} 处配置修改，保存后方可发布到节点`
                : '配置已变动，保存后方可发布到节点'}
            </p>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" className="min-h-9" disabled={saving}>
                放弃修改
              </Button>
            </DialogTrigger>
            <DialogContent
              title="放弃本地修改"
              description="丢弃尚未保存的所有内容，并重新加载已保存的最新草稿。"
              footer={
                <>
                  <Button variant="secondary" onClick={() => setDiscardDialogOpen(false)}>
                    继续编辑
                  </Button>
                  <Button
                    onClick={() => {
                      onDiscard();
                      setDiscardDialogOpen(false);
                    }}
                  >
                    放弃修改
                  </Button>
                </>
              }
            />
          </Dialog>

          <Button
            variant="primary"
            className="min-h-9"
            loading={saving}
            disabled={saving}
            onClick={() => void onSave()}
          >
            保存草稿
          </Button>
        </div>
      </div>
    </aside>
  );
}
