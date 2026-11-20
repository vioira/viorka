import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  getTemplateVersion,
  listTemplateHistory,
  restoreTemplateVersion,
  type TemplateRevision,
} from '@/api/subscription-template-history';
import type { SubscriptionTemplate } from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import TemplateReviewDialog from './TemplateReviewDialog';
import { useDialogFocus } from './useDialogFocus';

export default function TemplateHistoryDialog({
  source,
  session,
  onClose,
  onSaved,
}: {
  source: SubscriptionTemplate;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToastStack();
  const focus = useDialogFocus();
  const [items, setItems] = useState<TemplateRevision[] | null>(null);
  const [version, setVersion] = useState('');
  const [revision, setRevision] = useState<SubscriptionTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      const page = await listTemplateHistory(source.id, controller.signal);
      if (controller.signal.aborted) return;
      setItems(page.items);
      setVersion(page.items.length ? String(page.items[0].version) : '');
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: 'template-history',
          type: 'error',
          title: '未能读取历史版本',
          description: error instanceof Error ? error.message : '请重试读取。',
        });
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [source.id, toast]);
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);
  async function review() {
    if (!version || busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      const saved = await getTemplateVersion(source.id, Number(version), controller.signal);
      if (!controller.signal.aborted) setRevision(saved);
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: 'template-revision',
          type: 'error',
          title: '未能读取该版本',
          description: error instanceof Error ? error.message : '请刷新历史版本。',
        });
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function restore() {
    if (!revision || busy) return;
    setBusy(true);
    try {
      await restoreTemplateVersion(source, revision.version, session);
      toast({ type: 'success', title: `已从版本 ${revision.version} 恢复模板` });
      onSaved();
    } catch (error) {
      toast({
        id: 'template-restore',
        type: 'error',
        title: '未能回退模板',
        description: error instanceof Error ? error.message : '请刷新后重试。',
      });
    } finally {
      setBusy(false);
    }
  }
  if (revision)
    return (
      <TemplateReviewDialog
        source={source}
        draft={{
          ...revision,
          version: source.version,
          expected_references: source.references,
          confirm: true,
        }}
        session={session}
        busy={busy}
        restoreVersion={revision.version}
        onClose={() => setRevision(null)}
        onConfirm={() => void restore()}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        {...focus}
        data-subscription-management
        title={`${source.name} / 版本历史`}
        description={`当前版本 ${source.version}。保留最近 10 个历史版本，回退会生成新版本。`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              关闭
            </Button>
            <Button disabled={!version} loading={busy} onClick={() => void review()}>
              检查回退影响
            </Button>
          </>
        }
      >
        {items === null ? (
          <div className="flex items-center gap-3">
            <span className="text-sm">{busy ? '正在读取历史版本' : '历史版本尚未读取'}</span>
            {!busy && (
              <Button variant="secondary" onClick={() => void load()}>
                重新读取
              </Button>
            )}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm">尚无历史版本</p>
        ) : (
          <Select
            label="要恢复的版本"
            disabled={busy}
            value={version}
            onValueChange={setVersion}
            options={items.map((item) => ({
              value: String(item.version),
              label: `版本 ${item.version}，${new Date(item.archived_at).toLocaleString()} 归档`,
            }))}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
