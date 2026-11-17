import { RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  clearSubscriptionAccess,
  listSubscriptionAccess,
  type SubscriptionAccess,
  type SubscriptionItem,
  type SubscriptionRule,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable from '@/components/data-table';
import { useDialogFocus } from './useDialogFocus';

const resultLabels: Record<string, string> = {
  ok: '已下发',
  unrecognized: '未识别客户端',
  no_services: '没有可用服务',
  forbidden: '权限不足',
  unavailable: '暂不可用',
};

export default function AccessDialog({
  item,
  session,
  rules,
  onClose,
}: {
  item: SubscriptionItem;
  session: Session;
  rules: SubscriptionRule[] | null;
  onClose: () => void;
}) {
  const { toast } = useToastStack();
  const [entries, setEntries] = useState<SubscriptionAccess[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const dialogFocus = useDialogFocus();
  const confirmationFocus = useDialogFocus();
  const load = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    try {
      const response = await listSubscriptionAccess(item, controller.signal);
      if (!controller.signal.aborted) setEntries(response.items);
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: `subscription-access-${item.id}`,
          type: 'error',
          title: '未能读取访问记录',
          description: error instanceof Error ? error.message : '请刷新后重试。',
        });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [item, toast]);
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);
  async function clear() {
    if (loading) return;
    setLoading(true);
    try {
      await clearSubscriptionAccess(item, session);
      setEntries([]);
      setConfirming(false);
      toast({ type: 'success', title: '访问记录已清除' });
    } catch (error) {
      toast({
        id: `subscription-access-clear-${item.id}`,
        type: 'error',
        title: '未能清除访问记录',
        description: error instanceof Error ? error.message : '请稍后重试。',
      });
    } finally {
      setLoading(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        {...dialogFocus}
        data-subscription-management
        title={`${item.name} / 访问记录`}
        description="仅保留最近 20 条使用有效链接的请求。"
        className="[--dialog-width:880px]"
        footer={
          <>
            <Button
              loading={loading}
              variant="secondary"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              刷新记录
            </Button>
            <Button
              variant="secondary"
              disabled={loading || !entries?.length || session.user.role === 'viewer'}
              onClick={() => setConfirming(true)}
            >
              <Trash2 size={16} aria-hidden="true" />
              清除记录
            </Button>
          </>
        }
      >
        <DataTable
          caption="访问记录"
          loaded={entries !== null}
          loading={loading}
          emptyMessage="暂无访问记录"
          rows={(entries ?? []).map((entry) => ({ ...entry }))}
          rowKey="id"
          columns={[
            {
              key: 'at',
              label: '时间',
              render: (_, row) => (
                <span className="tabular-nums">{new Date(row.at).toLocaleString()}</span>
              ),
            },
            {
              key: 'user_agent',
              label: '客户端与配置',
              sortable: false,
              render: (_, row) => (
                <div className="space-y-1">
                  <p className="break-all">{row.user_agent || '未提供 User-Agent'}</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {row.rule_id
                      ? rules === null
                        ? '规则未读取'
                        : (rules.find((rule) => rule.id === row.rule_id)?.name ?? '已删除规则')
                      : row.format
                        ? '指定格式'
                        : '未匹配规则'}
                    {row.format ? ` / ${row.format}` : ''}
                  </p>
                </div>
              ),
            },
            {
              key: 'result',
              label: '结果',
              render: (_, row) => resultLabels[row.result] ?? '未知',
            },
          ]}
        />
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent
            {...confirmationFocus}
            data-subscription-management
            title="清除访问记录？"
            description={`将清除“${item.name}”的最近访问记录。`}
            footer={
              <Button variant="danger" loading={loading} onClick={() => void clear()}>
                <Trash2 size={16} aria-hidden="true" />
                清除记录
              </Button>
            }
          />
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
