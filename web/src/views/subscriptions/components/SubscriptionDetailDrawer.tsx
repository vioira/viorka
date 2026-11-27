import { KeyRound, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  clearSubscriptionAccess,
  listSubscriptionAccess,
  type SubscriptionAccess,
  type SubscriptionItem,
  type SubscriptionRule,
} from '@/api/subscriptions';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Drawer, DrawerContent, useDrawerItem } from '@/components/arc/drawer/drawer';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import InitialSkeleton from '@/components/initial-skeleton';
import { resultLabel } from './access-result';
import { accessResultTone, serviceRefKey, unavailableReasonLabel } from './service-meta';
import { useDialogFocus } from './useDialogFocus';

export type SubscriptionDetailTab = 'services' | 'access';

export default function SubscriptionDetailDrawer({
  item,
  initialTab,
  rules,
  session,
  canManage,
  onClose,
  onEdit,
  onRotate,
  onAccessCleared,
}: {
  item: SubscriptionItem | null;
  initialTab: SubscriptionDetailTab;
  rules: SubscriptionRule[] | null;
  session: Session;
  canManage: boolean;
  onClose: () => void;
  onEdit: (item: SubscriptionItem) => void;
  onRotate: (item: SubscriptionItem) => void;
  onAccessCleared: () => void;
}) {
  const shown = useDrawerItem(item);
  const { toast } = useToastStack();
  const confirmFocus = useDialogFocus();
  const [tab, setTab] = useState<SubscriptionDetailTab>(initialTab);
  const [entries, setEntries] = useState<SubscriptionAccess[] | null>(null);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const loadedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (item) {
      setTab(initialTab);
      if (loadedIdRef.current !== item.id) {
        setEntries(null);
        loadedIdRef.current = null;
      }
    }
  }, [item, initialTab]);

  const loadAccess = useCallback(
    async (target: SubscriptionItem) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoadingAccess(true);
      try {
        const response = await listSubscriptionAccess(target, controller.signal);
        if (!controller.signal.aborted) {
          setEntries(response.items);
          loadedIdRef.current = target.id;
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          toast({
            id: `subscription-access-${target.id}`,
            type: 'error',
            title: '未能读取访问记录',
            description: error instanceof Error ? error.message : '请刷新后重试。',
          });
        }
      } finally {
        if (!controller.signal.aborted) setLoadingAccess(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (item && tab === 'access' && loadedIdRef.current !== item.id) {
      void loadAccess(item);
    }
    return () => {
      if (!item) abortRef.current?.abort();
    };
  }, [item, tab, loadAccess]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function clearLogs() {
    if (!item || clearing) return;
    setClearing(true);
    try {
      await clearSubscriptionAccess(item, session);
      setEntries([]);
      setConfirmClear(false);
      onAccessCleared();
      toast({ type: 'success', title: '访问记录已清除' });
    } catch (error) {
      toast({
        id: `subscription-access-clear-${item.id}`,
        type: 'error',
        title: '未能清除访问记录',
        description: error instanceof Error ? error.message : '请稍后重试。',
      });
    } finally {
      setClearing(false);
    }
  }

  const firstAvailableService = shown?.services.find((service) => service.status === 'available');
  const firstAvailableKey = firstAvailableService ? serviceRefKey(firstAvailableService) : null;

  return (
    <>
      <Drawer
        open={item !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent
          data-subscription-management
          side="right"
          className="w-[min(560px,100vw)]!"
          title={shown?.name ?? '订阅详情'}
          titleDetail={shown ? (shown.revoked ? '已吊销' : '已签发') : undefined}
          description={shown ? `${new Date(shown.updated_at).toLocaleString()} 更新` : undefined}
          footer={
            shown && canManage ? (
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                <Button variant="secondary" onClick={() => onRotate(shown)}>
                  <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
                  {shown.revoked ? '签发新链接' : '轮换链接'}
                </Button>
                <Button onClick={() => onEdit(shown)}>
                  <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
                  编辑订阅
                </Button>
              </div>
            ) : undefined
          }
        >
          {shown && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SegmentedControl
                  label="详情视图"
                  value={tab}
                  onValueChange={(value) => setTab(value as SubscriptionDetailTab)}
                  options={[
                    { value: 'services', label: `服务与规则 (${shown.services.length})` },
                    { value: 'access', label: '访问记录' },
                  ]}
                />
                {tab === 'access' && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={loadingAccess}
                      disabled={loadingAccess}
                      onClick={() => void loadAccess(shown)}
                    >
                      <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
                      刷新
                    </Button>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={loadingAccess || !entries?.length}
                        onClick={() => setConfirmClear(true)}
                      >
                        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                        清除
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {tab === 'services' ? (
                <div className="space-y-5">
                  <section aria-label="已选服务" className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                        已选导出服务
                      </h3>
                      <span className="text-(length:--text-xs) tabular-nums text-text-secondary">
                        {shown.services.filter((s) => s.status === 'available').length} /{' '}
                        {shown.services.length} 可用
                      </span>
                    </div>
                    <ol className="divide-y divide-border-subtle rounded-(--radius-control) border-[1px] border-border">
                      {shown.services.map((service, index) => {
                        const key = serviceRefKey(service);
                        const isDefault = key === firstAvailableKey;
                        return (
                          <li
                            key={key}
                            className="flex items-start justify-between gap-3 px-3.5 py-3"
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-(length:--text-xs) tabular-nums text-text-secondary">
                                  {index + 1}
                                </span>
                                <span className="break-all text-(length:--text-sm) font-medium">
                                  {service.service_name || service.service_id}
                                </span>
                                {isDefault && (
                                  <Badge tone="info" size="sm">
                                    默认节点
                                  </Badge>
                                )}
                              </div>
                              <p className="break-all text-(length:--text-xs) text-text-secondary">
                                {service.node_name || service.node_id} / {service.engine}
                                {service.public_host
                                  ? ` / ${service.public_host}:${service.public_port}`
                                  : ''}
                              </p>
                              {service.status !== 'available' && (
                                <p className="text-(length:--text-xs) text-(--danger)">
                                  {unavailableReasonLabel(service.reason)}
                                </p>
                              )}
                              {service.incompatible_formats.length > 0 && (
                                <p className="text-(length:--text-xs) text-(--warning)">
                                  {service.incompatible_formats.join('、')} 不兼容 Xray REALITY
                                </p>
                              )}
                            </div>
                            <Badge
                              tone={service.status === 'available' ? 'success' : 'danger'}
                              size="sm"
                              className="shrink-0"
                            >
                              {service.status === 'available' ? '可用' : '异常'}
                            </Badge>
                          </li>
                        );
                      })}
                    </ol>
                  </section>

                  <section aria-label="绑定规则与端口" className="space-y-2.5">
                    <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                      客户端规则与端口
                    </h3>
                    <div className="space-y-3 rounded-(--radius-control) border-[1px] border-border p-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {shown.rule_ids.map((id) => (
                          <Badge key={id} tone="neutral" size="sm">
                            {rules?.find((rule) => rule.id === id)?.name ?? id}
                          </Badge>
                        ))}
                      </div>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t-[1px] border-border-subtle pt-2.5 text-(length:--text-xs)">
                        <dt className="text-text-secondary">Mihomo 本机端口</dt>
                        <dd className="tabular-nums">{shown.mihomo_port}</dd>
                      </dl>
                    </div>
                  </section>
                </div>
              ) : (
                <div className="space-y-3" aria-busy={loadingAccess}>
                  <p className="text-(length:--text-xs) text-text-secondary">
                    仅保留最近 20 条有效链接请求，不记录 IP 或完整 URL。
                  </p>
                  {entries === null && loadingAccess && (
                    <InitialSkeleton label="正在读取访问记录" lines={4} />
                  )}
                  {entries === null && !loadingAccess && (
                    <p className="py-8 text-center text-(length:--text-sm) text-text-secondary">
                      访问记录尚未读取，请点击刷新重试。
                    </p>
                  )}
                  {entries && entries.length === 0 && (
                    <p className="py-10 text-center text-(length:--text-sm) text-text-secondary">
                      暂无访问记录
                    </p>
                  )}
                  {entries && entries.length > 0 && (
                    <ul className="divide-y divide-border-subtle rounded-(--radius-control) border-[1px] border-border">
                      {entries.map((entry) => (
                        <li key={entry.id} className="space-y-1.5 px-3.5 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge tone={accessResultTone(entry.result)} size="sm">
                              {resultLabel(entry.result)}
                            </Badge>
                            <span className="text-(length:--text-xs) tabular-nums text-text-secondary">
                              {new Date(entry.at).toLocaleString()}
                            </span>
                          </div>
                          <p className="break-all font-mono text-(length:--text-xs)">
                            {entry.user_agent || '未提供 User-Agent'}
                          </p>
                          <p className="text-(length:--text-xs) text-text-secondary">
                            {entry.rule_id
                              ? rules === null
                                ? '规则未读取'
                                : (rules.find((rule) => rule.id === entry.rule_id)?.name ??
                                  '已删除规则')
                              : entry.format
                                ? '显式指定格式'
                                : '未匹配规则'}
                            {entry.format ? ` / ${entry.format}` : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <Dialog
        open={confirmClear}
        onOpenChange={(open) => {
          if (!clearing) setConfirmClear(open);
        }}
      >
        <DialogContent
          {...confirmFocus}
          data-subscription-management
          title="清除访问记录？"
          description={`将清除“${shown?.name ?? ''}”的全部最近拉取记录与摘要。`}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={clearing}
                onClick={() => setConfirmClear(false)}
              >
                取消
              </Button>
              <Button variant="danger" loading={clearing} onClick={() => void clearLogs()}>
                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                清除记录
              </Button>
            </>
          }
        />
      </Dialog>
    </>
  );
}
