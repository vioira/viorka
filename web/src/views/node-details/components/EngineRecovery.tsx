import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import {
  confirmManagedEngineRecovery,
  engineStatus,
  engineSyncError,
  type ManagedEngineRecovery,
  previewManagedEngineRecovery,
  startManagedEngineRecovery,
} from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useServerEvent } from '@/hooks/realtime';

export default function EngineRecovery({
  node,
  name,
  session,
  online,
  disabled = false,
  refresh,
}: {
  node: string;
  name: string;
  session: Session;
  online: boolean;
  disabled?: boolean;
  refresh: () => Promise<void>;
}) {
  const { toast } = useToastStack();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<ManagedEngineRecovery | null>(null);
  const task = useRef('');
  const key = useRef('');
  const request = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const confirmed = useRef(false);
  const pending =
    !!task.current && !['succeeded', 'failed', 'cancelled'].includes(preview?.state ?? '');
  const ready = preview?.state === 'succeeded' && !!preview.engine_id;
  const blocked = disabled || !online;

  useEffect(() => () => request.current?.abort(), []);

  function report(title: string, error: unknown) {
    toast({
      id: `engine-recovery-${node}-${name}`,
      type: 'error',
      title,
      description: error instanceof Error ? error.message : '请核对节点状态后重试。',
    });
  }

  async function load(id = task.current) {
    if (!id) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setReading(true);
    try {
      const result = await previewManagedEngineRecovery(node, id, controller.signal);
      if (controller.signal.aborted) return;
      setPreview(result);
      if (result.state === 'failed' || result.state === 'cancelled') {
        const description =
          result.error_code === 'engine_config_unavailable'
            ? '没有可验证的 Viorka 托管引擎，或活动配置与本机托管记录不一致。'
            : engineSyncError(result.error_code ?? '');
        report('无法恢复托管引擎', new Error(description));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof ApiError && error.code === 'engine_recovery_expired') {
          task.current = '';
          setPreview(null);
        }
        report('未能读取核对结果', error);
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setReading(false);
      }
    }
  }

  useServerEvent(
    (event) => {
      if (!open || !task.current || ready) return;
      if (
        event.type === 'ready' ||
        (event.type === 'change' &&
          event.change.kind === 'tasks' &&
          (!event.change.task_id || event.change.task_id === task.current))
      ) {
        void load();
      }
    },
    open ? [{ kind: 'tasks', node_id: node }] : [],
  );

  function close(value: boolean) {
    if (busy) return;
    if (!value) {
      request.current?.abort();
      request.current = null;
      setReading(false);
    } else if (task.current) void load();
    setOpen(value);
  }

  async function start() {
    setBusy(true);
    try {
      key.current ||= crypto.randomUUID();
      const result = await startManagedEngineRecovery(node, name, key.current, session);
      key.current = '';
      task.current = result.id;
      setPreview(null);
      await load(result.id);
    } catch (error) {
      report('未能提交引擎核对', error);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      await confirmManagedEngineRecovery(node, task.current, session);
      confirmed.current = true;
      setOpen(false);
      toast({ type: 'success', title: '已恢复托管引擎' });
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'engine_recovery_expired') {
        task.current = '';
        setPreview(null);
      }
      report('未能确认引擎恢复', error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button ref={trigger} variant="secondary" disabled={blocked}>
          <RotateCcw size={16} aria-hidden="true" />
          恢复托管引擎
        </Button>
      </DialogTrigger>
      <DialogContent
        title="恢复托管引擎"
        description={`核对节点上由 Viorka 安装的 ${name}。确认后沿用原引擎 ID、配置、服务和凭证，代理进程会保持当前状态。`}
        onCloseAutoFocus={(event) => {
          if (!confirmed.current && trigger.current?.isConnected) {
            event.preventDefault();
            trigger.current.focus();
          }
        }}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                关闭
              </Button>
            </DialogClose>
            {task.current && !ready && (
              <Button
                variant="secondary"
                loading={reading}
                disabled={busy || reading}
                onClick={() => void load()}
              >
                刷新核对结果
              </Button>
            )}
            {ready ? (
              <Button loading={busy} disabled={busy || blocked} onClick={() => void confirm()}>
                确认恢复
              </Button>
            ) : (
              <Button
                loading={busy}
                disabled={busy || blocked || pending}
                onClick={() => void start()}
              >
                核对本机引擎
              </Button>
            )}
          </>
        }
      >
        {pending && (
          <p role="status" className="text-text-secondary">
            正在核对节点上的引擎。
          </p>
        )}
        {ready && (
          <div className="space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt>原引擎 ID</dt>
              <dd className="break-all">{preview.engine_id}</dd>
              <dt>版本</dt>
              <dd>{preview.version}</dd>
              <dt>运行状态</dt>
              <dd>{engineStatus(preview.configured ? (preview.status ?? '') : 'installed')}</dd>
              <dt>运行意愿</dt>
              <dd>{preview.run_intent === 'stopped' ? '保持停止' : '允许运行'}</dd>
              <dt>配置</dt>
              <dd className="tabular-nums">
                {preview.configured ? `已应用修订 ${preview.revision}` : '未发布配置'}
              </dd>
            </dl>
            {preview.services.length > 0 && (
              <ul aria-label="可恢复服务" className="max-h-40 space-y-1 overflow-auto">
                {preview.services.map((service) => (
                  <li key={service.id} className="break-words">
                    {service.name}，端口 {service.listen_port}，
                    {service.enabled ? '已启用' : '已停用'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
