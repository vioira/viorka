import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  type AgentRelease,
  type AgentUpdateStatus,
  readAgentUpdate,
  saveAgentPolicy,
  submitAgentUpdate,
} from '@/api/agent-updates';
import type { Session } from '@/api/auth';
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
  return (
    <section aria-label="Agent 更新" className="space-y-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">Agent 更新</h2>
        <Button variant="ghost" onClick={() => void reload()}>
          刷新更新状态
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-(length:--text-sm) text-text-secondary">
        <span>当前版本 {status?.current_version || '未知'}</span>
        <span>稳定版 {status?.target?.version ?? '暂无可用版本信息'}</span>
        <span>
          上次检查 {status?.checked_at ? new Date(status.checked_at).toLocaleString() : '未知'}
        </span>
      </div>
      {status && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Switch
              label="自动更新 Agent"
              checked={status.auto_update}
              disabled={!admin || busy || (!status.capable && !status.auto_update)}
              onCheckedChange={change}
            />
          </div>
          {status.active_task ? (
            <Link to="?tab=tasks">查看更新任务</Link>
          ) : (
            admin && (
              <Dialog
                open={!!confirmed}
                onOpenChange={(open) => {
                  if (!busy) setConfirmed(open ? status.target : undefined);
                }}
              >
                <DialogTrigger asChild>
                  <Button
                    variant="secondary"
                    disabled={busy || !status.capable || !status.online || !status.available}
                  >
                    立即更新
                  </Button>
                </DialogTrigger>
                <DialogContent
                  title="更新 Agent"
                  description={`将 ${name} 的 Agent 从 ${status.current_version} 更新至 ${confirmed?.version ?? ''}。更新期间管理连接会短暂中断。`}
                  footer={
                    <>
                      <DialogClose asChild>
                        <Button variant="ghost" disabled={busy}>
                          取消
                        </Button>
                      </DialogClose>
                      <Button variant="secondary" loading={busy} onClick={submit}>
                        确认更新
                      </Button>
                    </>
                  }
                />
              </Dialog>
            )
          )}
        </div>
      )}
      {status && (!status.online || !status.capable) && (
        <p className="text-(length:--text-sm) text-text-secondary">
          {!status.online
            ? '节点离线，等待 Agent 重连。'
            : '此安装尚不支持面板更新，请在节点使用官方安装器升级 Agent。'}
        </p>
      )}
    </section>
  );
}
