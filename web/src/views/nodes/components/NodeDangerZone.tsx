import { Ban, KeyRound, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Session } from '@/api/auth';
import { revokeNode } from '@/api/node-tasks';
import { deleteNode, type NodeRecord } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { NodeInstallDialog } from '@/components/registration/NodeInstallDialog';

export default function NodeDangerZone({
  node,
  session,
  onChanged,
}: {
  node: NodeRecord;
  session: Session;
  onChanged?: () => Promise<void>;
}) {
  const { toast } = useToastStack();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const cancelDelete = useRef<HTMLButtonElement>(null);

  const admin = session.user.role === 'admin';
  if (!admin) return null;

  async function revoke() {
    setBusy(true);
    try {
      await revokeNode(node.id, session);
      setRevokeOpen(false);
      toast({
        type: 'success',
        title: '节点身份已吊销',
        description: 'Agent 管理连接已断开，节点已转为离线状态。',
      });
      await onChanged?.();
    } catch (cause) {
      toast({
        id: `revoke-${node.id}`,
        type: 'error',
        title: '未能确认身份吊销结果',
        description: cause instanceof Error ? cause.message : '请刷新节点详情重试。',
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteNode(node.id, session);
      setDeleteOpen(false);
      toast({
        type: 'success',
        title: '节点已删除',
        description: '节点资产元数据已从控制面移除。节点上的代理引擎未被强制终止。',
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
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="node-danger-heading" className="space-y-3">
      <div className="space-y-1">
        <h2
          id="node-danger-heading"
          className="text-(length:--text-base) font-medium text-foreground"
        >
          节点凭据与生命周期
        </h2>
        <p className="text-(length:--text-xs) text-text-secondary">
          以下操作立即生效，均不会卸载远端节点上的 Agent 或停止运行中的代理引擎。
        </p>
      </div>

      <div className="divide-y-[1px] divide-border rounded-(--radius-surface) border-[1px] border-border bg-surface">
        {/* Row 1: Re-enrollment */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:px-5">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-(length:--text-sm) font-medium text-foreground">
              重新签发注册令牌
            </div>
            <p className="text-(length:--text-xs) text-text-secondary">
              {node.state === 'online'
                ? '节点当前在线。若需重装系统或迁移机器，请先断开连接或吊销凭据后再重新签发。'
                : '签发新的注册令牌并撤销旧 Agent 凭据。重新注册后将核对托管引擎。'}
            </p>
          </div>
          <div>
            <NodeInstallDialog
              node={node}
              trigger={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy || node.state === 'online'}
                >
                  <KeyRound size={14} aria-hidden="true" />
                  重新签发
                </Button>
              }
            />
          </div>
        </div>

        {/* Row 2: Revoke Credentials */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:px-5">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-(length:--text-sm) font-medium text-foreground">
              吊销 Agent 凭据
            </div>
            <p className="text-(length:--text-xs) text-text-secondary">
              立即阻断该节点的 WSS 和 HTTP 接入通道，节点将无法再上报指标或接收任务。
            </p>
          </div>
          <Dialog
            open={revokeOpen}
            onOpenChange={(open) => {
              if (!busy) setRevokeOpen(open);
            }}
          >
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={busy || node.state === 'disabled'}
              >
                <Ban size={14} aria-hidden="true" />
                吊销凭据
              </Button>
            </DialogTrigger>
            <DialogContent
              title="吊销节点凭据"
              description={`确认吊销 ${node.name || node.id} 的 Agent 身份？当前连接将立即关闭，现有凭据无法再次接入。`}
              footer={
                <>
                  <DialogClose asChild>
                    <Button variant="secondary" disabled={busy}>
                      取消
                    </Button>
                  </DialogClose>
                  <Button variant="danger" loading={busy} onClick={() => void revoke()}>
                    <Ban size={16} aria-hidden="true" />
                    确认吊销凭据
                  </Button>
                </>
              }
            >
              <p className="pb-4 text-(length:--text-xs) text-text-secondary">
                此操作不会卸载远端节点上的常驻 Agent 程序，也不会删除已配置的代理服务。
              </p>
            </DialogContent>
          </Dialog>
        </div>

        {/* Row 3: Delete Node */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:px-5">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-(length:--text-sm) font-medium text-danger">从控制面移除节点</div>
            <p className="text-(length:--text-xs) text-text-secondary">
              彻底删除此节点的资产元数据记录与历史配置（审计记录保留）。此操作无法撤销。
            </p>
          </div>
          <Dialog
            open={deleteOpen}
            onOpenChange={(open) => {
              if (!busy) setDeleteOpen(open);
            }}
          >
            <DialogTrigger asChild>
              <Button type="button" variant="danger" size="sm" disabled={busy}>
                <Trash2 size={14} aria-hidden="true" />
                移除节点
              </Button>
            </DialogTrigger>
            <DialogContent
              title="移除节点资产"
              description={`确认彻底从控制面删除 ${node.name || node.id}？`}
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                cancelDelete.current?.focus();
              }}
              footer={
                <>
                  <DialogClose asChild>
                    <Button ref={cancelDelete} variant="secondary" disabled={busy}>
                      取消
                    </Button>
                  </DialogClose>
                  <Button variant="danger" loading={busy} onClick={() => void remove()}>
                    <Trash2 size={16} aria-hidden="true" />
                    确认永久移除
                  </Button>
                </>
              }
            >
              <div className="space-y-3 pb-4 text-(length:--text-xs) text-text-secondary">
                <p>
                  面板中的节点记录、注册令牌、Agent
                  凭证、地址与端口映射、历史任务和监控时序数据将被彻底删除，审计记录保留。
                </p>
                <p>当前管理连接将被终止。此操作不会强行停止或删除远端节点上的代理引擎进程。</p>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </section>
  );
}
