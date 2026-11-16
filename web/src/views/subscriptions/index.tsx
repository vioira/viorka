import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import {
  deleteSubscription,
  listSubscriptionRules,
  listSubscriptions,
  rotateSubscription,
  type SubscriptionIssued,
  type SubscriptionItem,
  type SubscriptionRule,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable from '@/components/data-table';
import AccessDialog from './components/AccessDialog';
import RecoveryPanel from './components/RecoveryPanel';
import RulesPanel from './components/RulesPanel';
import SubscriptionEditor from './components/SubscriptionEditor';
import { useDialogFocus } from './components/useDialogFocus';

type Action = { kind: 'rotate' | 'revoke' | 'delete'; item: SubscriptionItem };

function IssuedDialog({
  issued,
  onClose,
  returnFocus,
}: {
  issued: SubscriptionIssued;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const { toast } = useToastStack();
  const dialogFocus = useDialogFocus(returnFocus);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ type: 'success', title: '订阅链接已复制' });
    } catch {
      toast({
        id: 'subscription-copy',
        type: 'error',
        title: '未能复制订阅链接',
        description: '请选择链接并手动复制。',
      });
    }
  }
  const links = [
    { label: '自动识别链接', value: issued.url },
    ...Object.entries(issued.format_urls).map(([format, value]) => ({
      label: `${format} 格式链接`,
      value: value ?? '',
    })),
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        {...dialogFocus}
        title="保存订阅链接"
        description="链接包含访问凭证，仅在本次显示。请妥善保存；已下载的节点配置不会因链接吊销而失效。"
        className="sm:min-w-[min(720px,calc(100vw-32px))]"
        footer={<Button onClick={onClose}>完成保存</Button>}
      >
        <div className="space-y-4">
          {links.map((link) => (
            <div key={link.label} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label={link.label}
                  value={link.value}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
              </div>
              <Button variant="secondary" onClick={() => void copy(link.value)}>
                复制链接
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SubscriptionsPage() {
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const confirmationFocus = useDialogFocus();
  const [items, setItems] = useState<SubscriptionItem[] | null>(null);
  const [rules, setRules] = useState<SubscriptionRule[] | null>(null);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [editing, setEditing] = useState<SubscriptionItem | null | undefined>();
  const [issued, setIssued] = useState<SubscriptionIssued | null>(null);
  const [access, setAccess] = useState<SubscriptionItem | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const subscriptionsAbort = useRef<AbortController | null>(null);
  const rulesAbort = useRef<AbortController | null>(null);
  const issuedFocus = useRef<HTMLElement | null>(null);
  const canManage = session.user.role === 'admin' || session.user.role === 'operator';

  const load = useCallback(
    async (after = '') => {
      subscriptionsAbort.current?.abort();
      const controller = new AbortController();
      subscriptionsAbort.current = controller;
      setLoading(true);
      try {
        const result = await listSubscriptions(after, controller.signal);
        if (controller.signal.aborted) return;
        setItems((old) => (after ? [...(old ?? []), ...result.items] : result.items));
        setCursor(result.next_cursor);
      } catch (error) {
        if (!controller.signal.aborted)
          toast({
            id: 'subscriptions-load',
            type: 'error',
            title: '未能读取订阅',
            description: error instanceof Error ? error.message : '请刷新列表重试。',
          });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [toast],
  );
  const loadRules = useCallback(async () => {
    rulesAbort.current?.abort();
    const controller = new AbortController();
    rulesAbort.current = controller;
    setRulesLoading(true);
    try {
      const result = await listSubscriptionRules(controller.signal);
      if (!controller.signal.aborted) setRules(result.items);
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: 'subscription-rules-load',
          type: 'error',
          title: '未能读取应用规则',
          description: error instanceof Error ? error.message : '请刷新规则重试。',
        });
    } finally {
      if (!controller.signal.aborted) setRulesLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    void load();
    void loadRules();
    return () => {
      subscriptionsAbort.current?.abort();
      rulesAbort.current?.abort();
    };
  }, [load, loadRules]);

  async function perform() {
    if (!action || busy) return;
    setBusy(true);
    try {
      if (action.kind === 'delete') {
        await deleteSubscription(action.item, session);
        toast({ type: 'success', title: '订阅已删除' });
      } else {
        const result = await rotateSubscription(action.item, session, action.kind === 'revoke');
        if (action.kind === 'rotate') setIssued(result);
        else toast({ type: 'success', title: '订阅链接已吊销' });
      }
      setAction(null);
      await load();
    } catch (error) {
      toast({
        id: `subscription-${action.kind}`,
        type: 'error',
        title: '未能完成订阅操作',
        description: error instanceof Error ? error.message : '请刷新后重试。',
      });
    } finally {
      setBusy(false);
    }
  }
  const actionTitle =
    action?.kind === 'delete'
      ? '删除订阅？'
      : action?.kind === 'revoke'
        ? '吊销订阅链接？'
        : action?.item.revoked
          ? '签发订阅链接？'
          : '轮换订阅链接？';
  const actionDescription =
    action?.kind === 'delete'
      ? `将删除“${action.item.name}”并使链接失效。已下载的节点配置仍可能使用。`
      : action?.kind === 'revoke'
        ? `“${action.item.name}”的链接将立即失效。已下载的节点配置仍可能使用。`
        : action?.item.revoked
          ? `将为“${action.item.name}”签发新链接。完整链接仅显示一次。`
          : `“${action?.item.name ?? ''}”的旧链接将立即失效，客户端需要更新链接。`;

  return (
    <Tabs defaultValue="subscriptions">
      <TabsList aria-label="订阅管理">
        <TabsTrigger value="subscriptions">订阅</TabsTrigger>
        <TabsTrigger value="rules">应用规则</TabsTrigger>
        {canManage && <TabsTrigger value="recovery">恢复核对</TabsTrigger>}
      </TabsList>
      <TabsContent value="subscriptions" className="space-y-4">
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" disabled={loading} onClick={() => void load()}>
            刷新订阅
          </Button>
          {canManage && (
            <Button
              disabled={rules === null || loading}
              onClick={(event) => {
                issuedFocus.current = event.currentTarget;
                setEditing(null);
              }}
            >
              添加订阅
            </Button>
          )}
        </div>
        <div className="v-card">
          <DataTable
            caption="订阅列表"
            loaded={items !== null}
            loading={loading}
            emptyMessage="暂无订阅"
            rows={(items ?? []).map((item) => ({ ...item }))}
            rowKey="id"
            columns={[
              {
                key: 'name',
                label: '名称',
                render: (_, item) => <span className="break-all">{item.name}</span>,
              },
              {
                key: 'services',
                label: '服务',
                render: (_, item) => (
                  <span className="tabular-nums">
                    {item.services.filter((service) => service.status === 'available').length} /{' '}
                    {item.services.length}
                  </span>
                ),
              },
              {
                key: 'rule_ids',
                label: '应用规则',
                render: (_, item) =>
                  item.rule_ids
                    .map((id) => rules?.find((rule) => rule.id === id)?.name ?? id)
                    .join('、'),
              },
              {
                key: 'revoked',
                label: '链接状态',
                render: (_, item) => (item.revoked ? '已吊销' : '已签发'),
              },
              {
                key: 'actions',
                label: '操作',
                sortable: false,
                render: (_, item) => (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setAccess(item)}>
                      访问记录
                    </Button>
                    {canManage && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={rules === null}
                          onClick={() => setEditing(item)}
                        >
                          编辑订阅
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(event) => {
                            issuedFocus.current = event.currentTarget;
                            setAction({ kind: 'rotate', item });
                          }}
                        >
                          {item.revoked ? '签发链接' : '轮换链接'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={item.revoked}
                          onClick={() => setAction({ kind: 'revoke', item })}
                        >
                          吊销链接
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setAction({ kind: 'delete', item })}
                        >
                          删除订阅
                        </Button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
          {cursor && (
            <Button variant="secondary" disabled={loading} onClick={() => void load(cursor)}>
              加载更多订阅
            </Button>
          )}
        </div>
      </TabsContent>
      <TabsContent value="rules">
        <RulesPanel
          rules={rules ?? []}
          loaded={rules !== null}
          loading={rulesLoading}
          session={session}
          onChanged={() => {
            void loadRules();
            void load();
          }}
        />
      </TabsContent>
      {canManage && (
        <TabsContent value="recovery">
          <RecoveryPanel session={session} onChanged={() => void load()} />
        </TabsContent>
      )}
      {editing !== undefined && rules && (
        <SubscriptionEditor
          item={editing}
          rules={rules}
          session={session}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
          onIssued={(result) => {
            setEditing(undefined);
            setIssued(result);
            void load();
          }}
        />
      )}
      {access && (
        <AccessDialog
          item={access}
          rules={rules}
          session={session}
          onClose={() => setAccess(null)}
        />
      )}
      {issued && (
        <IssuedDialog
          issued={issued}
          onClose={() => setIssued(null)}
          returnFocus={() => issuedFocus.current}
        />
      )}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent
          {...confirmationFocus}
          title={actionTitle}
          description={actionDescription}
          footer={
            <Button
              variant={action?.kind === 'rotate' ? 'primary' : 'danger'}
              loading={busy}
              onClick={() => void perform()}
            >
              {action?.kind === 'delete'
                ? '删除订阅'
                : action?.kind === 'revoke'
                  ? '吊销链接'
                  : action?.item.revoked
                    ? '签发链接'
                    : '轮换链接'}
            </Button>
          }
        />
      </Dialog>
    </Tabs>
  );
}
