import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import {
  listSubscriptionRecoveries,
  listSubscriptionRules,
  listSubscriptionTemplates,
  type RecoveryStatus,
  type SubscriptionIssued,
  type SubscriptionRule,
  type SubscriptionTemplate,
} from '@/api/subscriptions';
import { Badge } from '@/components/arc/badge/badge';
import { Tabs, TabsContent, TabsTrigger } from '@/components/arc/tabs/tabs';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { PageTabsList } from '@/components/page-tabs';
import { useServerEvent } from '@/hooks/realtime';
import IssuedDialog from './components/IssuedDialog';
import { isRecoveryPending, type SubscriptionsContextValue } from './context';

const primaryTabs = [
  { path: '/subscriptions', label: '订阅列表' },
  { path: '/subscriptions/rules', label: '分发规则' },
  { path: '/subscriptions/templates', label: '配置模板' },
  { path: '/subscriptions/recovery', label: '恢复核对', manageOnly: true },
] as const;

export default function SubscriptionsLayout() {
  const session = useOutletContext<Session>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { toast } = useToastStack();

  const canManage = session.user.role === 'admin' || session.user.role === 'operator';
  const isAdmin = session.user.role === 'admin';

  const [rules, setRules] = useState<SubscriptionRule[] | null>(null);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [templates, setTemplates] = useState<SubscriptionTemplate[] | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [recoveryMap, setRecoveryMap] = useState<Map<string, RecoveryStatus> | null>(null);
  const [issued, setIssued] = useState<SubscriptionIssued | null>(null);

  const rulesAbort = useRef<AbortController | null>(null);
  const templatesAbort = useRef<AbortController | null>(null);
  const recoveryAbort = useRef<AbortController | null>(null);
  const issuedReturnFocus = useRef<HTMLElement | null>(null);

  const reloadRules = useCallback(async () => {
    rulesAbort.current?.abort();
    const controller = new AbortController();
    rulesAbort.current = controller;
    setRulesLoading(true);
    try {
      const result = await listSubscriptionRules(controller.signal);
      if (!controller.signal.aborted) setRules(result.items);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast({
          id: 'subscription-rules-load',
          type: 'error',
          title: '未能读取应用规则',
          description: error instanceof Error ? error.message : '请刷新规则重试。',
        });
      }
    } finally {
      if (!controller.signal.aborted) setRulesLoading(false);
    }
  }, [toast]);

  const reloadTemplates = useCallback(async () => {
    templatesAbort.current?.abort();
    const controller = new AbortController();
    templatesAbort.current = controller;
    setTemplatesLoading(true);
    try {
      const result = await listSubscriptionTemplates(controller.signal);
      if (!controller.signal.aborted) setTemplates(result.items);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast({
          id: 'subscription-templates-load',
          type: 'error',
          title: '未能读取配置模板',
          description: error instanceof Error ? error.message : '请刷新模板重试。',
        });
      }
    } finally {
      if (!controller.signal.aborted) setTemplatesLoading(false);
    }
  }, [toast]);

  const reloadRecoverySummary = useCallback(async () => {
    if (!canManage) {
      setRecoveryMap(new Map());
      return;
    }
    recoveryAbort.current?.abort();
    const controller = new AbortController();
    recoveryAbort.current = controller;
    try {
      const map = new Map<string, RecoveryStatus>();
      let cursor = '';
      // Bounded walk (max 5 pages = 100 engines) to avoid unbounded polling on layout mount.
      for (let page = 0; page < 5; page++) {
        const response = await listSubscriptionRecoveries(cursor, controller.signal);
        if (controller.signal.aborted) return;
        for (const item of response.items) map.set(item.engine_id, item);
        if (!response.next_cursor) break;
        cursor = response.next_cursor;
      }
      if (!controller.signal.aborted) setRecoveryMap(map);
    } catch {
      // Non-blocking badge summary; recovery page handles its own error toast on open.
    }
  }, [canManage]);

  useEffect(() => {
    void reloadRules();
    void reloadTemplates();
    void reloadRecoverySummary();
    return () => {
      rulesAbort.current?.abort();
      templatesAbort.current?.abort();
      recoveryAbort.current?.abort();
    };
  }, [reloadRules, reloadTemplates, reloadRecoverySummary]);

  useServerEvent(
    (event) => {
      if (!canManage) return;
      if (event.type === 'ready') {
        void reloadRecoverySummary();
        return;
      }
      if (event.type !== 'change' || event.change.kind !== 'recovery') return;
      const row = event.change.recovery;
      if (!row) {
        void reloadRecoverySummary();
        return;
      }
      setRecoveryMap((previous) => {
        const next = new Map(previous ?? []);
        next.set(row.engine_id, row);
        return next;
      });
    },
    canManage ? [{ kind: 'recovery', all: true }] : [],
  );

  const pendingRecoveryCount = useMemo(() => {
    if (!recoveryMap) return 0;
    let count = 0;
    for (const item of recoveryMap.values()) {
      if (isRecoveryPending(item)) count++;
    }
    return count;
  }, [recoveryMap]);

  const openIssued = useCallback((next: SubscriptionIssued) => {
    issuedReturnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIssued(next);
  }, []);

  const contextValue = useMemo<SubscriptionsContextValue>(
    () => ({
      session,
      canManage,
      isAdmin,
      rules,
      rulesLoading,
      templates,
      templatesLoading,
      pendingRecoveryCount,
      recoveryCountLoaded: recoveryMap !== null,
      reloadRules,
      reloadTemplates,
      reloadRecoverySummary,
      openIssued,
    }),
    [
      session,
      canManage,
      isAdmin,
      rules,
      rulesLoading,
      templates,
      templatesLoading,
      pendingRecoveryCount,
      recoveryMap,
      reloadRules,
      reloadTemplates,
      reloadRecoverySummary,
      openIssued,
    ],
  );

  const visibleTabs = primaryTabs.filter((tab) => !('manageOnly' in tab) || canManage);
  const normalizedPath =
    pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const activeTab = visibleTabs.find((tab) => tab.path === normalizedPath)?.path ?? null;

  return (
    <div data-subscription-management className="min-w-0">
      {activeTab ? (
        <Tabs value={activeTab} onValueChange={(path) => void navigate(path)} className="min-w-0">
          <PageTabsList aria-label="订阅管理分类">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.path} value={tab.path}>
                <span className="inline-flex items-center gap-2">
                  <span>{tab.label}</span>
                  {tab.path === '/subscriptions/recovery' && pendingRecoveryCount > 0 && (
                    <Badge tone="warning" size="sm" pill className="tabular-nums">
                      {pendingRecoveryCount}
                    </Badge>
                  )}
                </span>
              </TabsTrigger>
            ))}
          </PageTabsList>
          {visibleTabs.map((tab) => (
            <TabsContent
              key={tab.path}
              value={tab.path}
              forceMount
              hidden={activeTab !== tab.path}
              className="space-y-6"
            >
              {activeTab === tab.path && <Outlet context={contextValue} />}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <Outlet context={contextValue} />
      )}
      {issued && (
        <IssuedDialog
          issued={issued}
          onClose={() => setIssued(null)}
          returnFocus={() =>
            issuedReturnFocus.current?.isConnected ? issuedReturnFocus.current : null
          }
        />
      )}
    </div>
  );
}
