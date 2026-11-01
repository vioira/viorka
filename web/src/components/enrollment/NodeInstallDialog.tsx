import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { type Enrollment, renewEnrollment } from '@/api/enrollment';
import type { NodeRecord } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import { EnrollmentToken } from './EnrollmentToken';
import { InstallInstructions } from './InstallInstructions';

export function NodeInstallDialog({ node }: { node: NodeRecord }) {
  const session = useOutletContext<Session>();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Enrollment | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [, setError] = useToastFeedback('error');
  const [, setNotice] = useToastFeedback('success');
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(
      () => setResult(null),
      Math.max(0, Date.parse(result.expires_at) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [result]);
  // Discard registration tokens when the node leaves the pending state.
  useEffect(() => {
    if (node.state !== 'pending') {
      setResult(null);
    }
    if (node.state === 'online') setOpen(false);
  }, [node.state]);
  async function generate() {
    if (busy.current || !['pending', 'offline', 'disabled'].includes(node.state)) return;
    busy.current = true;
    setPending(true);
    try {
      setResult(await renewEnrollment(session, node.id, node.state !== 'pending'));
      setNotice('注册令牌已生成，请执行新安装命令完成注册。');
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : '无法生成安装命令。'} 请刷新节点状态后重试；若请求中断，原 Agent 凭证或旧令牌可能已失效。`,
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (session.user.role !== 'admin' || node.state === 'online') return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy.current) return;
        setOpen(value);
        if (!value) setResult(null);
        else if (node.state === 'pending') void generate();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          className="min-h-11"
          aria-label={`安装 Agent：${node.name || node.id}`}
        >
          安装 Agent
        </Button>
      </DialogTrigger>
      <DialogContent
        title="安装 Agent"
        description={`在 ${node.name || node.id} 上安装 Agent。`}
        className="[--dialog-width:720px]"
      >
        <div className="space-y-5">
          <p className="text-text-secondary">
            {node.state === 'pending'
              ? '重新生成会立即使该节点之前的注册令牌和安装命令失效。新令牌有效期为 15 分钟。'
              : '确认重新注册后，原 Agent 凭证立即失效，节点转为待注册。节点 ID、历史监控、历史任务、审计与节点配置均保留。请在原节点执行新命令；仅重启 Agent 管理服务，不停止代理服务。'}
          </p>
          {result ? (
            <>
              <EnrollmentToken enrollment={result} />
              <InstallInstructions key={result.token} token={result.token} reenrollNode={node.id} />
            </>
          ) : (
            <p role="status" className="text-text-secondary">
              {pending
                ? '正在生成注册令牌和安装命令…'
                : node.state === 'pending'
                  ? '尚无有效注册令牌，请重新生成安装命令。'
                  : '确认重新注册后，将显示新的注册令牌和安装命令。'}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" disabled={pending} className="min-h-11">
                关闭弹框
              </Button>
            </DialogClose>
            {!result && (
              <Button
                loading={pending}
                disabled={pending || !['pending', 'offline', 'disabled'].includes(node.state)}
                className="min-h-11"
                onClick={generate}
              >
                {node.state === 'pending' ? '生成安装命令' : '确认重新注册'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
