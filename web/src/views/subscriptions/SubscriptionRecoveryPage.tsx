import { ArrowRight, Check, Globe, RefreshCw, ScanSearch, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { engineSyncError } from '@/api/engines';
import {
  adoptSubscriptionRecovery,
  checkSubscriptionRecovery,
  confirmSubscriptionEndpoint,
  getSubscriptionRecovery,
  listSubscriptionRecoveries,
  type RecoveryService,
  type RecoveryStatus,
} from '@/api/subscriptions';
import { Badge, type BadgeTone } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EmptyStates from '@/components/empty-states';
import InitialSkeleton from '@/components/initial-skeleton';
import { useServerEvent } from '@/hooks/realtime';
import RecoveryChanges from './components/RecoveryChanges';
import { useDialogFocus } from './components/useDialogFocus';
import { isRecoveryPending, useSubscriptionsContext } from './context';

const activeStates = new Set(['queued', 'dispatched', 'accepted', 'running']);

const changeLabels: Record<string, string> = {
  added: '节点新增',
  changed: '配置有变化',
  removed: '节点已移除',
  unchanged: '一致',
};

function recoveryStage(item: RecoveryStatus): { label: string; tone: BadgeTone } {
  if (activeStates.has(item.task_state)) return { label: '核对中', tone: 'info' };
  if (item.state === 'mismatch') return { label: '配置不一致', tone: 'warning' };
  if (item.state === 'matched') {
    if (item.runtime_status === 'not_installed') return { label: '节点未安装', tone: 'neutral' };
    const unconfirmed = item.services.filter(
      (service) => service.enabled && service.change !== 'removed' && !service.confirmed,
    ).length;
    if (unconfirmed > 0) return { label: `${unconfirmed} 入口待确认`, tone: 'warning' };
    return { label: '已完成', tone: 'success' };
  }
  if (item.task_state === 'failed' || item.task_state === 'cancelled') {
    return { label: '核对失败', tone: 'danger' };
  }
  return { label: '待核对', tone: 'neutral' };
}

export default function SubscriptionRecoveryPage() {
  const { session, canManage, reloadRecoverySummary } = useSubscriptionsContext();
  const navigate = useNavigate();
  const { toast } = useToastStack();
  const confirmationFocus = useDialogFocus();

  const [items, setItems] = useState<RecoveryStatus[] | null>(null);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<{
    engineId: string;
    serviceId: string;
    host: string;
    port: string;
  } | null>(null);
  const [savingEndpoint, setSavingEndpoint] = useState(false);

  const abort = useRef<AbortController | null>(null);
  const rowRead = useRef<{ id: string; controller: AbortController } | null>(null);
  const pageCount = useRef(1);
  const patches = useRef(new Map<string, RecoveryStatus>());
  const keys = useRef<Record<string, string>>({});

  const load = useCallback(
    async (after = '') => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setLoading(true);
      patches.current.clear();
      try {
        let response = await listSubscriptionRecoveries(after, controller.signal);
        const rows = [...response.items];
        let count = 1;
        while (
          !after &&
          count < pageCount.current &&
          response.next_cursor &&
          !controller.signal.aborted
        ) {
          response = await listSubscriptionRecoveries(response.next_cursor, controller.signal);
          rows.push(...response.items);
          count++;
        }
        if (controller.signal.aborted) return;
        pageCount.current = after ? pageCount.current + 1 : count;
        const updatedRows = rows.map((item) => patches.current.get(item.engine_id) ?? item);
        setItems((old) => (after ? [...(old ?? []), ...updatedRows] : updatedRows));
        setCursor(response.next_cursor);
      } catch (error) {
        if (!controller.signal.aborted) {
          toast({
            id: 'subscription-recovery-load',
            type: 'error',
            title: '未能读取恢复核对状态',
            description: error instanceof Error ? error.message : '请刷新后重试。',
          });
        }
      } finally {
        if (abort.current === controller) {
          abort.current = null;
          patches.current.clear();
          if (!controller.signal.aborted) setLoading(false);
        }
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!canManage) return;
    void load();
    return () => {
      abort.current?.abort();
      rowRead.current?.controller.abort();
    };
  }, [canManage, load]);

  useServerEvent(
    (event) => {
      if (!canManage) return;
      if (event.type === 'ready') {
        void load();
        return;
      }
      if (event.type !== 'change' || event.change.kind !== 'recovery') return;
      const row = event.change.recovery;
      if (!row) {
        void load();
        return;
      }
      if (rowRead.current?.id === row.engine_id) rowRead.current.controller.abort();
      if (abort.current) {
        if (patches.current.size >= 256) {
          void load();
          return;
        }
        patches.current.set(row.engine_id, row);
      }
      setItems((old) => old?.map((item) => (item.engine_id === row.engine_id ? row : item)) ?? old);
    },
    canManage ? [{ kind: 'recovery', all: true }] : [],
  );

  const active = useMemo(() => {
    if (!items?.length) return null;
    return items.find((item) => item.engine_id === selectedId) ?? items[0];
  }, [items, selectedId]);

  if (!canManage) return <Navigate to="/subscriptions" replace />;

  async function refreshRow(id: string) {
    rowRead.current?.controller.abort();
    const controller = new AbortController();
    rowRead.current = { id, controller };
    try {
      const row = await getSubscriptionRecovery(id, controller.signal);
      if (controller.signal.aborted) return;
      if (abort.current) patches.current.set(id, row);
      setItems((old) => old?.map((item) => (item.engine_id === id ? row : item)) ?? old);
      void reloadRecoverySummary();
    } catch (error) {
      if (!controller.signal.aborted) {
        toast({
          type: 'error',
          id: 'subscription-recovery-load',
          title: '恢复核对状态读取失败',
          description: error instanceof Error ? error.message : '请刷新重试。',
        });
      }
    } finally {
      if (rowRead.current?.controller === controller) rowRead.current = null;
    }
  }

  async function checkEngine(item: RecoveryStatus) {
    if (busy) return;
    setBusy(true);
    keys.current[item.engine_id] ??= crypto.randomUUID();
    try {
      await checkSubscriptionRecovery(item, keys.current[item.engine_id], session);
      delete keys.current[item.engine_id];
      toast({ type: 'info', title: '已提交只读核对任务' });
      await refreshRow(item.engine_id);
    } catch (error) {
      toast({
        id: `subscription-recovery-check-${item.engine_id}`,
        type: 'error',
        title: '未能提交核对任务',
        description:
          error instanceof Error ? error.message : '请确认节点在线并支持当前 Agent 协议。',
      });
    } finally {
      setBusy(false);
    }
  }

  async function adoptEngine() {
    if (!active || busy) return;
    setBusy(true);
    try {
      await adoptSubscriptionRecovery(active, session);
      setAdopting(false);
      toast({ type: 'success', title: '已采用节点当前配置' });
      await refreshRow(active.engine_id);
    } catch (error) {
      toast({
        id: `subscription-recovery-adopt-${active.engine_id}`,
        type: 'error',
        title: '未能采用节点配置',
        description: error instanceof Error ? error.message : '请重新核对并检查节点权限。',
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitInlineEndpoint(engine: RecoveryStatus, service: RecoveryService) {
    if (!editingEndpoint || savingEndpoint) return;
    const portNumber = Number(editingEndpoint.port);
    if (
      !editingEndpoint.host.trim() ||
      !Number.isInteger(portNumber) ||
      portNumber < 1 ||
      portNumber > 65535
    ) {
      toast({
        id: 'subscription-endpoint-invalid',
        type: 'error',
        title: '请检查公网入口',
        description: '填写地址和 1 至 65535 的端口。',
      });
      return;
    }
    setSavingEndpoint(true);
    try {
      await confirmSubscriptionEndpoint(
        engine,
        service,
        editingEndpoint.host.trim(),
        portNumber,
        session,
      );
      setEditingEndpoint(null);
      toast({ type: 'success', title: '公网入口已确认' });
      await refreshRow(engine.engine_id);
    } catch (error) {
      toast({
        id: `subscription-endpoint-${engine.engine_id}`,
        type: 'error',
        title: '未能确认公网入口',
        description: error instanceof Error ? error.message : '请刷新后重试。',
      });
    } finally {
      setSavingEndpoint(false);
    }
  }

  const totalCount = items?.length ?? 0;
  const completedCount = items ? items.filter((item) => !isRecoveryPending(item)).length : 0;
  const activeIndex =
    active && items ? items.findIndex((i) => i.engine_id === active.engine_id) : 0;

  return (
    <div className="min-w-0 space-y-5">
      {/* Progress Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-panel) border-[1px] border-border bg-surface px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-(length:--text-sm) font-medium">
            <ShieldCheck
              size={16}
              strokeWidth={1.75}
              className="text-(--accent)"
              aria-hidden="true"
            />
            <span>备份恢复隔离核对</span>
          </div>
          {items !== null && totalCount > 0 && (
            <Badge
              tone={completedCount === totalCount ? 'success' : 'warning'}
              size="sm"
              className="tabular-nums"
            >
              已完成 {completedCount} / {totalCount}
              {cursor ? '+' : ''} 个引擎
            </Badge>
          )}
          <span className="text-(length:--text-xs) text-text-secondary">
            核对和采用只更新面板记录，不修改或重启节点。
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={loading}
            disabled={loading}
            onClick={() => {
              void load();
              void reloadRecoverySummary();
            }}
          >
            <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
            刷新状态
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void navigate('/subscriptions?status=revoked')}
          >
            前往签发新链接
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {items === null && loading && <InitialSkeleton label="正在读取恢复核对状态" lines={6} />}

      {items === null && !loading && (
        <EmptyStates
          variant="unknown"
          title="恢复核对状态尚未读取"
          description="请点击刷新状态重新读取。"
        />
      )}

      {items && items.length === 0 && (
        <EmptyStates
          variant="empty"
          title="没有需要核对的引擎"
          description="从备份恢复数据库后，受隔离的托管引擎会在此列出等待只读核对。"
        />
      )}

      {items && items.length > 0 && active && (
        <div className="space-y-4">
          {/* Mobile / Tablet Compact Engine Switcher */}
          <div className="flex items-center justify-between gap-2 rounded-(--radius-panel) border-[1px] border-border bg-surface p-3.5 lg:hidden">
            <div className="min-w-0 flex-1">
              <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
                当前引擎（{activeIndex + 1} / {items.length}
                {cursor ? '+' : ''}）
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="truncate text-(length:--text-sm) font-medium text-foreground">
                  {active.node_name} / {active.engine_name}
                </span>
                <Badge tone={recoveryStage(active).tone} size="sm" className="shrink-0">
                  {recoveryStage(active).label}
                </Badge>
              </div>
            </div>
            <Drawer open={switcherOpen} onOpenChange={setSwitcherOpen}>
              <DrawerTrigger asChild>
                <Button size="sm" variant="secondary" className="shrink-0">
                  切换引擎
                </Button>
              </DrawerTrigger>
              <DrawerContent
                side="bottom"
                title="切换受隔离引擎"
                description={`共 ${items.length}${cursor ? '+' : ''} 个引擎`}
              >
                <div className="space-y-3">
                  <ul className="divide-y-[1px] divide-border-subtle overflow-hidden rounded-(--radius-control) border-[1px] border-border">
                    {items.map((item) => {
                      const stage = recoveryStage(item);
                      const selected = active.engine_id === item.engine_id;
                      return (
                        <li key={item.engine_id}>
                          <button
                            type="button"
                            aria-current={selected ? 'true' : undefined}
                            onClick={() => {
                              setSelectedId(item.engine_id);
                              setEditingEndpoint(null);
                              setSwitcherOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2.5 px-3.5 py-3 text-left transition-colors ${
                              selected
                                ? 'bg-(--table-row-selected)'
                                : 'bg-surface hover:bg-surface-muted/50'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`size-2 shrink-0 rounded-full ${
                                    item.node_state === 'online'
                                      ? 'bg-(--success)'
                                      : 'bg-(--border-strong)'
                                  }`}
                                  aria-hidden="true"
                                />
                                <span className="truncate text-(length:--text-sm) font-medium">
                                  {item.node_name} / {item.engine_name}
                                </span>
                              </div>
                              <p className="mt-0.5 pl-4 text-(length:--text-xs) text-text-secondary">
                                {item.node_state === 'online' ? '在线' : '离线'}
                              </p>
                            </div>
                            <Badge tone={stage.tone} size="sm" className="shrink-0">
                              {stage.label}
                            </Badge>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {cursor && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      disabled={loading}
                      onClick={() => void load(cursor)}
                    >
                      加载更多引擎
                    </Button>
                  )}
                </div>
              </DrawerContent>
            </Drawer>
          </div>

          <div className="grid min-w-0 items-start gap-5 lg:grid-cols-12">
            {/* Desktop Left Engine Queue */}
            <aside
              aria-label="隔离引擎队列"
              className="hidden min-w-0 overflow-hidden rounded-(--radius-panel) border-[1px] border-border bg-surface lg:col-span-4 lg:block"
            >
              <div className="flex items-center justify-between border-b-[1px] border-border-subtle px-4 py-3">
                <span className="text-(length:--text-xs) font-medium text-text-secondary">
                  受隔离引擎
                </span>
                <span className="text-(length:--text-xs) tabular-nums text-text-secondary">
                  {items.length} 项
                </span>
              </div>
              <ul className="divide-y divide-border-subtle">
                {items.map((item) => {
                  const stage = recoveryStage(item);
                  const selected = active.engine_id === item.engine_id;
                  return (
                    <li key={item.engine_id}>
                      <button
                        type="button"
                        aria-current={selected ? 'true' : undefined}
                        className={`flex w-full cursor-pointer items-center justify-between gap-2.5 border-0 px-4 py-3.5 text-left transition-colors ${
                          selected
                            ? 'bg-(--table-row-selected)'
                            : 'bg-transparent hover:bg-(--table-row-hover)'
                        }`}
                        onClick={() => {
                          setSelectedId(item.engine_id);
                          setEditingEndpoint(null);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`size-2 shrink-0 rounded-full ${
                                item.node_state === 'online'
                                  ? 'bg-(--success)'
                                  : 'bg-(--border-strong)'
                              }`}
                              aria-hidden="true"
                            />
                            <span className="truncate text-(length:--text-sm) font-medium">
                              {item.node_name}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate pl-4 text-(length:--text-xs) text-text-secondary">
                            {item.engine_name}
                            {item.node_state !== 'online' ? '（离线）' : ''}
                          </p>
                        </div>
                        <Badge tone={stage.tone} size="sm" className="shrink-0">
                          {stage.label}
                        </Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {cursor && (
                <div className="border-t-[1px] border-border-subtle p-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={loading}
                    onClick={() => void load(cursor)}
                  >
                    加载更多引擎
                  </Button>
                </div>
              )}
            </aside>

            {/* Right Two-Step Verification Panel */}
            <section
              aria-label="引擎核对详情"
              className="min-w-0 space-y-6 rounded-(--radius-panel) border-[1px] border-border bg-surface p-6 lg:col-span-8"
            >
              <header className="flex flex-wrap items-start justify-between gap-3 border-b-[1px] border-border-subtle pb-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="break-all text-(length:--text-base) font-medium">
                      {active.node_name} / {active.engine_name}
                    </h2>
                    <Badge tone={recoveryStage(active).tone} size="sm">
                      {recoveryStage(active).label}
                    </Badge>
                  </div>
                  <p className="text-(length:--text-xs) text-text-secondary" role="status">
                    {active.task_state === 'failed' && active.error_code
                      ? `最近核对失败：${engineSyncError(active.error_code)}`
                      : active.node_state === 'online'
                        ? '节点在线，可发起只读核对回报托管配置。'
                        : '节点当前离线，请待节点上线后再发起核对。'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={
                    busy || active.node_state !== 'online' || activeStates.has(active.task_state)
                  }
                  loading={activeStates.has(active.task_state)}
                  onClick={() => void checkEngine(active)}
                >
                  <ScanSearch size={15} strokeWidth={1.75} aria-hidden="true" />
                  {active.state === 'pending' ? '发起只读核对' : '重新核对'}
                </Button>
              </header>

              {/* Step 1: Config Check & Adopt */}
              <section className="space-y-3" aria-label="第一步：核对节点配置">
                <div className="flex items-center gap-2.5">
                  <Badge
                    tone={active.state === 'matched' ? 'success' : 'info'}
                    size="sm"
                    pill
                    className="tabular-nums"
                  >
                    {active.state === 'matched' ? '步骤 1 已完成' : '步骤 1'}
                  </Badge>
                  <h3 className="text-(length:--text-sm) font-medium">核对节点当前配置</h3>
                </div>

                {active.state === 'pending' && (
                  <p className="rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/40 px-4 py-3 text-(length:--text-xs) text-text-secondary">
                    {activeStates.has(active.task_state)
                      ? '已派发只读核对任务，完成后会自动更新当前页面状态。'
                      : '点击右上角“发起只读核对”比对节点当前托管配置与面板备份记录。'}
                  </p>
                )}

                {active.state === 'mismatch' && (
                  <div className="space-y-4">
                    <p className="text-(length:--text-xs) text-text-secondary">
                      备份记录与节点当前托管配置不一致，查看脱敏差异后可采用节点现状：
                    </p>
                    <RecoveryChanges changes={active.changes} />
                    <div>
                      <Button disabled={busy} onClick={() => setAdopting(true)}>
                        <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                        采用节点当前配置
                      </Button>
                    </div>
                  </div>
                )}

                {active.state === 'matched' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/40 px-4 py-3 text-(length:--text-xs)">
                    <span className="text-(--success)">
                      {active.runtime_status === 'not_installed'
                        ? 'Agent 确认该引擎当前未安装，原有旧服务选择已失效。'
                        : '节点当前托管配置已核对一致。'}
                    </span>
                    {active.draft_needs_review && (
                      <span className="text-text-secondary">
                        备份草稿仍需在节点详情重新核对后发布。
                      </span>
                    )}
                  </div>
                )}
              </section>

              {/* Step 2: Inline Public Endpoint Confirmation */}
              <section
                className="space-y-3 border-t-[1px] border-border-subtle pt-5"
                aria-label="第二步：确认公网入口"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Badge
                      tone={active.state === 'matched' ? 'info' : 'neutral'}
                      size="sm"
                      pill
                      className="tabular-nums"
                    >
                      步骤 2
                    </Badge>
                    <h3 className="text-(length:--text-sm) font-medium">确认服务公网入口</h3>
                  </div>
                  <span className="text-(length:--text-xs) text-text-secondary">
                    确认地址和端口不会验证公网连通性
                  </span>
                </div>

                {active.state !== 'matched' && (
                  <p className="text-(length:--text-xs) text-text-secondary">
                    完成步骤 1 的配置核对或采用后，可在此逐项确认服务的公网地址与端口。
                  </p>
                )}

                {active.services.length === 0 ? (
                  <p className="text-(length:--text-xs) text-text-secondary">没有待确认的服务。</p>
                ) : (
                  <ul className="divide-y divide-border-subtle rounded-(--radius-control) border-[1px] border-border">
                    {active.services.map((service) => {
                      const canConfirm =
                        active.state === 'matched' &&
                        service.enabled &&
                        service.change !== 'removed';
                      const isEditing =
                        editingEndpoint?.engineId === active.engine_id &&
                        editingEndpoint.serviceId === service.id;

                      return (
                        <li key={service.id} className="space-y-3 px-4 py-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="break-all text-(length:--text-sm) font-medium">
                                  {service.name}
                                </span>
                                <Badge tone="neutral" size="sm">
                                  {changeLabels[service.change] ?? service.change}
                                </Badge>
                                {service.credentials_changed && (
                                  <Badge tone="warning" size="sm">
                                    凭证已变化
                                  </Badge>
                                )}
                                {service.confirmed ? (
                                  <Badge tone="success" size="sm">
                                    已确认
                                  </Badge>
                                ) : (
                                  canConfirm && (
                                    <Badge tone="warning" size="sm">
                                      待确认
                                    </Badge>
                                  )
                                )}
                              </div>
                              <p className="font-mono text-(length:--text-xs) text-text-secondary">
                                {service.public_host
                                  ? `${service.public_host}:${service.public_port}`
                                  : '未配置公网入口'}
                              </p>
                            </div>

                            {canConfirm && !isEditing && (
                              <Button
                                size="sm"
                                variant={service.confirmed ? 'secondary' : 'primary'}
                                onClick={() =>
                                  setEditingEndpoint({
                                    engineId: active.engine_id,
                                    serviceId: service.id,
                                    host: service.public_host,
                                    port: service.public_port ? String(service.public_port) : '',
                                  })
                                }
                              >
                                <Globe size={14} strokeWidth={1.75} aria-hidden="true" />
                                {service.confirmed ? '修改公网入口' : '确认公网入口'}
                              </Button>
                            )}
                          </div>

                          {isEditing && (
                            <form
                              className="grid items-end gap-3 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/40 p-3.5 sm:grid-cols-[minmax(0,1fr)_128px_auto]"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void submitInlineEndpoint(active, service);
                              }}
                            >
                              <Input
                                label="公网地址"
                                value={editingEndpoint.host}
                                maxLength={253}
                                required
                                disabled={savingEndpoint}
                                onChange={(event) =>
                                  setEditingEndpoint((prev) =>
                                    prev ? { ...prev, host: event.target.value } : null,
                                  )
                                }
                              />
                              <Input
                                label="公网端口"
                                type="number"
                                min={1}
                                max={65535}
                                required
                                disabled={savingEndpoint}
                                value={editingEndpoint.port}
                                onChange={(event) =>
                                  setEditingEndpoint((prev) =>
                                    prev ? { ...prev, port: event.target.value } : null,
                                  )
                                }
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={savingEndpoint}
                                  onClick={() => setEditingEndpoint(null)}
                                >
                                  取消
                                </Button>
                                <Button type="submit" size="sm" loading={savingEndpoint}>
                                  <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                                  确认保存
                                </Button>
                              </div>
                            </form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </section>
          </div>
        </div>
      )}

      <Dialog
        open={adopting}
        onOpenChange={(open) => {
          if (!busy) setAdopting(open);
        }}
      >
        <DialogContent
          data-subscription-management
          {...confirmationFocus}
          title="采用节点当前配置？"
          description="将更新面板中的引擎状态，保留备份草稿并要求重新核对。不会修改或重启节点。"
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setAdopting(false)}>
                取消
              </Button>
              <Button loading={busy} onClick={() => void adoptEngine()}>
                <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                确认采用配置
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
