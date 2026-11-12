import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Session } from '@/api/auth';
import { inspectNode, revokeNode } from '@/api/node-tasks';
import { deleteNode, type NodeRecord } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { NodeInstallDialog } from '@/components/enrollment/NodeInstallDialog';

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
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const cancelDelete = useRef<HTMLButtonElement>(null);
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
  async function remove() {
    if (!node || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await deleteNode(node.id, session);
      setDeleteOpen(false);
      toast({
        type: 'success',
        title: '节点已删除',
        description: '节点上的 Agent 和代理服务未被移除。',
      });
      void navigate('/nodes', { replace: true });
    } catch (cause) {
      toast({
        id: `delete-${node.id}`,
        type: 'error',
        title: '未能确认节点删除结果',
        description: cause instanceof Error ? cause.message : '请刷新节点后重试。',
      });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {node && <NodeInstallDialog node={node} />}
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
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="secondary" disabled={busy}>
                    取消吊销
                  </Button>
                </DialogClose>
                <Button variant="danger" loading={busy} onClick={() => void revoke()}>
                  确认吊销身份
                </Button>
              </>
            }
          />
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
      {session.user.role === 'admin' && (
        <Dialog
          open={deleteOpen}
          onOpenChange={(value) => {
            if (!busy) setDeleteOpen(value);
          }}
        >
          <DialogTrigger asChild>
            <Button variant="danger" disabled={!node || busy}>
              删除节点
            </Button>
          </DialogTrigger>
          <DialogContent
            title="删除节点"
            description={`确认永久删除 ${node?.name || node?.id || '此节点'}？`}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelDelete.current?.focus();
            }}
            footer={
              <>
                <DialogClose asChild>
                  <Button ref={cancelDelete} variant="secondary" disabled={busy}>
                    取消删除
                  </Button>
                </DialogClose>
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  确认删除节点
                </Button>
              </>
            }
          >
            <div className="space-y-4 text-text-secondary">
              <p className="wrap-anywhere">节点 ID：{node?.id}</p>
              <p>
                面板中的节点记录、注册令牌、Agent
                凭证、地址与端口记录、历史任务、监控数据和通知将被删除，审计记录保留。删除后无法撤销，需要重新添加节点并注册
                Agent
                才能恢复管理。已部署的托管引擎、服务配置和凭证可在新注册时恢复，未发布的草稿不会保留。
              </p>
              <p>当前管理连接将关闭。此操作不会卸载节点上的 Agent，也不会停止或删除代理服务。</p>
              <p>有未完成任务、独立代理服务或中转依赖时，请先处理后再删除。</p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
