import { Save, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';

export interface StickyDraftDockProps {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  onSave: () => Promise<void>;
  onDiscard: () => void;
}

export default function StickyDraftDock({
  dirty,
  saving,
  canSave,
  onSave,
  onDiscard,
}: StickyDraftDockProps) {
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  useEffect(() => {
    if (!dirty || !canSave) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, [contenteditable="true"], [role="dialog"]')
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!saving) {
          void onSave();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canSave, dirty, saving, onSave]);

  if (!dirty) return null;

  return (
    <aside aria-label="引擎草稿" className="fixed inset-x-0 bottom-4 z-40 mx-auto max-w-xl px-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-(--radius-panel) border-[1px] border-border bg-surface p-3 shadow-floating">
        <p className="flex items-center gap-2 text-(length:--text-sm) font-medium" role="status">
          <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          {saving ? '正在保存草稿' : '草稿有未保存的修改'}
        </p>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" disabled={saving}>
                放弃修改
              </Button>
            </DialogTrigger>
            <DialogContent
              title="放弃草稿中的修改？"
              description="将恢复到最近保存的草稿。"
              footer={
                <>
                  <Button variant="ghost" onClick={() => setDiscardDialogOpen(false)}>
                    继续编辑
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      onDiscard();
                      setDiscardDialogOpen(false);
                    }}
                  >
                    <Undo2 size={16} aria-hidden="true" />
                    放弃修改
                  </Button>
                </>
              }
            />
          </Dialog>

          <Button
            variant="secondary"
            loading={saving}
            disabled={!canSave || saving}
            onClick={() => void onSave()}
          >
            <Save size={16} aria-hidden="true" />
            保存草稿
          </Button>
        </div>
      </div>
    </aside>
  );
}
