import { ArrowUpRight, Download, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  type AgentRelease,
  type AgentUpdateStatus,
  readAgentUpdate,
  saveAgentPolicy,
  submitAgentUpdate,
} from '@/api/agent-updates';
import type { Session } from '@/api/auth';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Switch } from '@/components/arc/switch/switch';
import { useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function AgentUpdates({
  id,
  name,
  session,
}: {
  id: string;
  name: string;
  session: Session;
}) {
  const autoUpdateTitleId = useId();
  const autoUpdateHintId = useId();
  const [status, setStatus] = useState<AgentUpdateStatus>();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<AgentRelease>();
  const request = useRef<AbortController | null>(null);
  const [, report] = useToastFeedback('error', `agent-update-${id}`);
  const [, notify] = useToastFeedback('success');

  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await readAgentUpdate(id, controller.signal);
      if (!controller.signal.aborted) setStatus(result);
    } catch (error) {
      if (!controller.signal.aborted)
        report(error instanceof Error ? error.message : '读取更新状态失败，请刷新重试。');
    }
  }, [id, report]);

  useEffect(() => {
    void reload();
    return () => request.current?.abort();
  }, [reload]);

  useServerEvent(
    (event) => {
      if (
        event.type === 'ready' ||
        (event.type === 'change' &&
          ['node', 'tasks'].includes(event.change.kind) &&
          (!event.change.node_id || event.change.node_id === id))
      )
        void reload();
    },
    [
      { kind: 'tasks', node_id: id },
      { kind: 'node', node_id: id },
    ],
  );

  const change = async (enabled: boolean) => {
    setBusy(true);
    try {
      const result = await saveAgentPolicy(id, enabled, session.csrf_token);
      request.current?.abort();
      setStatus(result);
      notify(enabled ? '已开启自动更新' : '已关闭自动更新');
    } catch (error) {
      report(error instanceof Error ? error.message : '保存自动更新设置失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!confirmed) return;
    setBusy(true);
    try {
      await submitAgentUpdate(id, confirmed, session.csrf_token);
      setConfirmed(undefined);
      notify('已提交 Agent 更新任务');
      await reload();
    } catch (error) {
      report(error instanceof Error ? error.message : '提交更新失败，请刷新重试。');
    } finally {
      setBusy(false);
    }
  };

  const admin = session.user.role === 'admin';
  const manualHint = !status
    ? '正在读取 Agent 更新状态。'
    : !status.online
      ? '节点离线，等待 Agent 重连后可执行升级。'
      : !status.capable
        ? '此安装尚不支持面板更新，请在节点使用官方安装器升级 Agent。'
        : status.active_task
          ? '已存在进行中的更新任务，可在任务标签页查看执行进度。'
          : status.available
            ? '更新期间管理连接会短暂中断，节点已有代理服务不受影响。'
            : '当前已运行最新可用版本。';

  return (
    <section aria-labelledby="agent-updates-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="agent-updates-heading"
          className="text-(length:--text-base) font-medium text-foreground"
        >
          Agent 版本与更新
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => void reload()}>
          <RefreshCw size={14} aria-hidden="true" />
          刷新状态
        </Button>
      </div>

      <div className="divide-y-[1px] divide-border rounded-(--radius-surface) border-[1px] border-border bg-surface">
        {/* Row 1: Version Summary */}
        <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3 sm:px-5">
          <div className="space-y-0.5">
            <dt className="text-(length:--text-xs) text-text-secondary">当前版本</dt>
            <dd className="font-mono text-(length:--text-sm) font-medium text-foreground tabular-nums">
              {status?.current_version || '未知'}
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-(length:--text-xs) text-text-secondary">最新稳定版</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-(length:--text-sm) font-medium text-foreground tabular-nums">
                {status?.target?.version ?? '暂无可用版本'}
              </span>
              {status?.available && (
                <Badge tone="success" size="sm" pill>
                  可更新
                </Badge>
              )}
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-(length:--text-xs) text-text-secondary">上次检查</dt>
            <dd className="text-(length:--text-sm) text-text-secondary tabular-nums">
              {status?.checked_at ? new Date(status.checked_at).toLocaleString('zh-CN') : '未知'}
            </dd>
          </div>
        </dl>

        {/* Row 2: Auto Update Policy */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:px-5">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div
              id={autoUpdateTitleId}
              className="text-(length:--text-sm) font-medium text-foreground"
            >
              自动更新 Agent
            </div>
            <p id={autoUpdateHintId} className="text-(length:--text-xs) text-text-secondary">
              发现新稳定版本时自动下发升级任务，开关立即生效。
            </p>
          </div>
          <Switch
            aria-labelledby={autoUpdateTitleId}
            aria-describedby={autoUpdateHintId}
            checked={status?.auto_update ?? false}
            disabled={!status || !admin || busy || (!status.capable && !status.auto_update)}
            onCheckedChange={change}
          />
        </div>

        {/* Row 3: Manual Upgrade */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:px-5">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-(length:--text-sm) font-medium text-foreground">手动升级</div>
            <p className="text-(length:--text-xs) text-text-secondary">{manualHint}</p>
          </div>
          {status?.active_task ? (
            <Link
              to="?tab=tasks"
              className="inline-flex items-center gap-1.5 rounded-(--radius-control) border-[1px] border-border bg-surface-raised px-3 py-1.5 text-(length:--text-xs) font-medium text-foreground hover:bg-surface-muted"
            >
              <span>查看更新任务</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          ) : (
            admin && (
              <Dialog
                open={!!confirmed}
                onOpenChange={(open) => {
                  if (!busy) setConfirmed(open ? status?.target : undefined);
                }}
              >
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={
                      !status || busy || !status.capable || !status.online || !status.available
                    }
                  >
                    <Download size={14} aria-hidden="true" />
                    {status?.available && status.target?.version
                      ? `立即更新至 ${status.target.version}`
                      : '立即更新'}
                  </Button>
                </DialogTrigger>
                <DialogContent
                  title="更新 Agent"
                  description={`将 ${name} 的 Agent 从 ${status?.current_version ?? '当前版本'} 更新至 ${confirmed?.version ?? ''}。更新期间管理连接会短暂中断。`}
                  footer={
                    <>
                      <DialogClose asChild>
                        <Button variant="secondary" disabled={busy}>
                          取消
                        </Button>
                      </DialogClose>
                      <Button loading={busy} onClick={() => void submit()}>
                        确认更新
                      </Button>
                    </>
                  }
                />
              </Dialog>
            )
          )}
        </div>
      </div>
    </section>
  );
}
