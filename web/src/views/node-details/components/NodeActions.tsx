import { useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { inspectNode, revokeNode } from '@/api/node-tasks';
import type { NodeRecord } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export default function NodeActions({
  node,
  session,
  onChanged,
  onTask,
}: {
  node: NodeRecord | null;
  session: Session;
  onChanged: () => Promise<void>;
  onTask: () => void;
}) {
  const { toast } = useToastStack();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [open, setOpen] = useState(false);
  const key = useRef<string | null>(null);
  const disabled = !node || node.state === 'disabled' || busy;
  async function inspect() {
    if (!node || locked.current) return;
    locked.current = true;
    setBusy(true);
    key.current ??= crypto.randomUUID();
    try {
      await inspectNode(node.id, session, key.current);
      key.current = null;
      toast({
        type: 'success',
        title: '检查任务已提交',
        description: '等待 Agent 执行，请在任务标签查看实际结果。',
      });
      onTask();
    } catch (cause) {
      toast({
        id: `inspect-${node.id}`,
        type: 'error',
        title: '检查任务提交未确认',
        description: `${cause instanceof Error ? cause.message : '请重试。'} 重试将复用同一请求标识。`,
      });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function revoke() {
    if (!node || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await revokeNode(node.id, session);
      setOpen(false);
      toast({ type: 'success', title: '节点身份已吊销' });
      await onChanged();
    } catch (cause) {
      toast({
        id: `revoke-${node.id}`,
        type: 'error',
        title: '未能确认身份吊销结果',
        description: cause instanceof Error ? cause.message : '请刷新节点详情。',
      });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {session.user.role === 'admin' && (
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (!busy) setOpen(value);
          }}
        >
          <DialogTrigger asChild>
            <Button variant="ghost" disabled={disabled}>
              吊销身份
            </Button>
          </DialogTrigger>
          <DialogContent
            title="吊销节点身份"
            description={`确认吊销 ${node?.name || node?.id || '此节点'} 的 Agent 身份？当前管理连接将关闭，现有凭证无法重新连接。此操作不会卸载 Agent 或删除代理服务。`}
          >
            <div className="flex flex-wrap justify-end gap-3">
              <DialogClose asChild>
                <Button variant="secondary" disabled={busy}>
                  取消吊销
                </Button>
              </DialogClose>
              <Button variant="danger" loading={busy} onClick={() => void revoke()}>
                确认吊销身份
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {session.user.role !== 'viewer' && (
        <Button
          variant="secondary"
          disabled={disabled}
          loading={busy}
          onClick={() => void inspect()}
        >
          只读检查
        </Button>
      )}
    </div>
  );
}
