import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Clock,
  Pencil,
  PowerOff,
  Radio,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { deleteRelay, type RelayRoute, retestPublic, submitRelay } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { CopyButton } from '@/components/arc/copy-button/copy-button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Drawer, DrawerContent, useDrawerItem } from '@/components/arc/drawer/drawer';
import { type DropdownItem, DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import RelayChainStrip from '@/components/proxy/RelayChainStrip';
import {
  canDeleteRelay,
  canProbeEntryToLanding,
  canRetestPublicProbe,
  canWithdrawRelay,
  endpointText,
  localTime,
  needsRelayPublication,
  nodeEnginePath,
  proxyServicePath,
  type RelayStepState,
  relayNextHint,
  relayStatusLabel,
  relayTone,
  relayVerificationSteps,
  taskStateLabel,
} from '@/components/proxy/relay-meta';

function StepIcon({ state }: { state: RelayStepState }) {
  if (state === 'passed') {
    return (
      <CheckCircle2
        size={16}
        strokeWidth={1.75}
        className="mt-0.5 shrink-0 text-success"
        aria-hidden="true"
      />
    );
  }
  if (state === 'failed') {
    return (
      <XCircle
        size={16}
        strokeWidth={1.75}
        className="mt-0.5 shrink-0 text-danger"
        aria-hidden="true"
      />
    );
  }
  if (state === 'pending') {
    return (
      <Clock
        size={16}
        strokeWidth={1.75}
        className="mt-0.5 shrink-0 text-warning"
        aria-hidden="true"
      />
    );
  }
  return (
    <CircleDashed
      size={16}
      strokeWidth={1.75}
      className="mt-0.5 shrink-0 text-text-muted"
      aria-hidden="true"
    />
  );
}

const stepToneText: Record<RelayStepState, string> = {
  passed: 'text-success',
  failed: 'text-danger',
  pending: 'text-warning',
  idle: 'text-text-secondary',
};

export default function RelayDiagnostics({
  route,
  onClose,
  onChange,
  onEdit,
  onPublish,
  returnFocus,
}: {
  route: RelayRoute | null;
  onClose: () => void;
  onChange: () => Promise<void>;
  onEdit: (route: RelayRoute) => void;
  onPublish: (route: RelayRoute) => void;
  returnFocus: () => void;
}) {
  const r = useDrawerItem(route);
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const [dialog, setDialog] = useState<'' | 'withdraw' | 'delete'>('');
  const [busy, setBusy] = useState(false);
  const requestKey = useRef('');
  const trigger = useRef<HTMLElement | null>(null);
  const [review, setReview] = useState<RelayRoute | null>(null);

  const startConfirm = (target: RelayRoute, op: 'withdraw' | 'delete') => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestKey.current = crypto.randomUUID();
    setReview(target);
    setDialog(op);
  };

  async function confirmAction() {
    if (!dialog || !review || busy) return;
    setBusy(true);
    try {
      if (dialog === 'withdraw') await submitRelay(review, 'withdraw', requestKey.current, session);
      else await deleteRelay(review, session);
      toast({
        type: 'success',
        title: dialog === 'delete' ? '已删除中转线路' : '已停止分发并提交撤除任务',
      });
      const deleted = dialog === 'delete';
      setDialog('');
      if (deleted) onClose();
      await onChange();
    } catch (e) {
      toast({
        id: 'relay-action',
        type: 'error',
        title: '线路操作失败',
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function recheckPublic(target: RelayRoute) {
    const q = target.public_probe;
    if (!q || busy) return;
    setBusy(true);
    try {
      await retestPublic(target, q, session);
      toast({ type: 'success', title: '公网检测已排队' });
      await onChange();
    } catch (err) {
      toast({
        id: 'relay-public-probe',
        type: 'error',
        title: '未能提交公网检测',
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function probeDial(target: RelayRoute) {
    if (busy) return;
    setBusy(true);
    try {
      await submitRelay(target, 'probe', crypto.randomUUID(), session);
      toast({ type: 'success', title: '已提交入口到落地重测任务' });
      await onChange();
    } catch (e) {
      toast({
        id: 'relay-probe',
        type: 'error',
        title: '未能提交重测任务',
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const d = r?.draft;
  const q = r?.public_probe;
  const publicPending = q?.state === 'queued' || q?.state === 'checking';
  const canRetestPublic = Boolean(r && canRetestPublicProbe(r) && q && !publicPending);
  const canProbeDial = Boolean(r && canProbeEntryToLanding(r));
  const needsPublish = Boolean(r && !r.cleanup_only && needsRelayPublication(r));
  const needsReconfirmLanding = Boolean(r && !r.cleanup_only && r.reason === 'landing_changed');
  const needsPublicRetry = Boolean(
    r &&
      canRetestPublic &&
      (r.reason === 'public_failed' || r.reason === 'probe_unavailable' || r.public_stale),
  );
  const steps = r ? relayVerificationSteps(r) : [];
  const nextHint = r ? relayNextHint(r) : '';
  const draftDiffersFromServing = Boolean(
    r?.serving_path &&
      (r.published?.version !== r.draft.version || r.serving_revision !== r.target_revision),
  );

  // Build overflow dropdown items so primary action bar stays clean (one primary CTA per surface).
  const overflowItems: DropdownItem[] = [];
  if (r?.can_manage) {
    if (!r.cleanup_only && !needsReconfirmLanding) {
      overflowItems.push({
        label: '编辑草稿',
        icon: <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />,
        onSelect: () => onEdit(r),
      });
    }
    if (canProbeDial) {
      overflowItems.push({
        label: '重测入口到落地',
        icon: <Activity size={15} strokeWidth={1.75} aria-hidden="true" />,
        disabled: busy,
        onSelect: () => void probeDial(r),
      });
    }
    if (canRetestPublic && !needsPublicRetry) {
      overflowItems.push({
        label: '重新检测公网',
        icon: <Radio size={15} strokeWidth={1.75} aria-hidden="true" />,
        disabled: busy,
        onSelect: () => void recheckPublic(r),
      });
    }
    if (canWithdrawRelay(r)) {
      overflowItems.push({
        label: '停用并撤除规则',
        icon: <PowerOff size={15} strokeWidth={1.75} aria-hidden="true" />,
        disabled: busy,
        separatorBefore: overflowItems.length > 0,
        onSelect: () => startConfirm(r, 'withdraw'),
      });
    }
    if (canDeleteRelay(r)) {
      overflowItems.push({
        label: '删除线路',
        icon: <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />,
        disabled: busy,
        destructive: true,
        separatorBefore: !canWithdrawRelay(r) && overflowItems.length > 0,
        onSelect: () => startConfirm(r, 'delete'),
      });
    }
  }

  const dialogTitle =
    dialog === 'withdraw' ? '停用并撤除规则' : dialog === 'delete' ? '删除中转线路' : '';

  return (
    <>
      <Drawer
        open={route !== null}
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <DrawerContent
          title={d?.name ?? '中转线路诊断'}
          description={
            r && d
              ? `${r.entry_name} → ${r.cleanup_only ? '受限落地' : d.landing_name || '落地服务'}`
              : undefined
          }
          className="[--drawer-size:min(40rem,calc(100vw-var(--space-4)))]"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocus();
          }}
          footer={
            r && d ? (
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={nodeEnginePath(r.entry_node, 'realm')}
                    className="inline-flex items-center gap-1 text-(length:--text-xs) font-medium text-accent hover:underline"
                  >
                    入口 Realm
                    <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                  {!r.cleanup_only && d.landing_engine_id && d.landing_service_id && (
                    <Link
                      to={proxyServicePath(d.landing_engine_id, d.landing_service_id)}
                      className="inline-flex items-center gap-1 text-(length:--text-xs) font-medium text-accent hover:underline"
                    >
                      落地代理服务
                      <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
                    </Link>
                  )}
                </div>
                <Button type="button" variant="secondary" onClick={onClose}>
                  关闭
                </Button>
              </div>
            ) : undefined
          }
        >
          {r && d && (
            <div className="space-y-6">
              {/* Status Summary + Single Contextual Primary Action */}
              <div className="space-y-3 border-b-[1px] border-border-subtle pb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge dot tone={relayTone(r)}>
                      {relayStatusLabel(r)}
                    </Badge>
                    {r.published && r.published.version !== d.version && (
                      <Badge size="sm" tone="warning">
                        草稿有未发布修改
                      </Badge>
                    )}
                    {r.public_stale && r.reason === 'available' && (
                      <Badge size="sm" tone="warning">
                        公网验证超过 24 小时
                      </Badge>
                    )}
                  </div>

                  {r.can_manage && (
                    <div className="flex flex-wrap items-center gap-2">
                      {needsReconfirmLanding ? (
                        <Button size="sm" onClick={() => onEdit(r)}>
                          <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
                          重新确认落地
                        </Button>
                      ) : needsPublish ? (
                        <Button
                          size="sm"
                          disabled={!r.publish_base || busy}
                          onClick={() => onPublish(r)}
                        >
                          <Send size={15} strokeWidth={1.75} aria-hidden="true" />
                          审查并发布
                        </Button>
                      ) : needsPublicRetry ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          loading={busy}
                          onClick={() => void recheckPublic(r)}
                        >
                          <Radio size={15} strokeWidth={1.75} aria-hidden="true" />
                          重新检测公网
                        </Button>
                      ) : null}

                      {overflowItems.length > 0 && (
                        <DropdownMenu label="更多操作" items={overflowItems} />
                      )}
                    </div>
                  )}
                </div>

                {nextHint && (
                  <p
                    role="status"
                    className="text-(length:--text-xs) leading-relaxed text-text-secondary"
                  >
                    {nextHint}
                  </p>
                )}
              </div>

              {/* Section 1: 3-Hop Topology Chain */}
              <section aria-label="转发链路" className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                    转发链路（草稿 v{d.version}）
                  </h3>
                  {r.serving_path && (
                    <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                      订阅生效 r{r.serving_revision}
                    </span>
                  )}
                </div>

                <RelayChainStrip
                  entryName={r.entry_name}
                  entryNodeId={r.entry_node}
                  entryOnline={r.online}
                  publicEndpoint={d.public}
                  listenEndpoint={d.listen}
                  dialEndpoint={d.dial}
                  landingName={d.landing_name}
                  landingListen={d.landing_listen}
                  landingEngineId={d.landing_engine_id}
                  landingServiceId={d.landing_service_id}
                  landingRevision={d.landing_revision}
                  cleanupOnly={r.cleanup_only}
                />

                {draftDiffersFromServing && r.serving_path && (
                  <p className="rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted px-3 py-2 text-(length:--text-xs) text-text-secondary tabular-nums wrap-anywhere">
                    当前订阅仍输出已确认版本 r{r.serving_revision}：
                    {endpointText(r.serving_path.public)} → {r.serving_path.landing_name}
                    {r.serving_revision !== r.target_revision ? '（回滚保护生效）' : ''}
                  </p>
                )}
              </section>

              {/* Section 2: 3-Stage Verification Pipeline */}
              <section aria-label="连通与发布验证" className="space-y-2.5">
                <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                  三段验证状态
                </h3>
                <ol className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background">
                  {steps.map((step) => (
                    <li
                      key={step.key}
                      className="flex items-start justify-between gap-3 px-3.5 py-3"
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <StepIcon state={step.state} />
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-(length:--text-sm) font-medium text-foreground">
                              {step.title}
                            </span>
                            <span
                              className={`text-(length:--text-xs) font-medium ${stepToneText[step.state]}`}
                            >
                              {step.statusText}
                            </span>
                          </div>
                          <p className="text-(length:--text-xs) leading-relaxed text-text-secondary tabular-nums wrap-anywhere">
                            {step.detail}
                          </p>
                          {step.key === 'public' && q?.address && q.address !== q.endpoint.host && (
                            <p className="font-mono text-(length:--text-xs) text-text-muted tabular-nums">
                              探测命中 IP：{q.address}
                            </p>
                          )}
                        </div>
                      </div>

                      {r.can_manage && step.key === 'dial' && canProbeDial && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void probeDial(r)}
                        >
                          重测拨号
                        </Button>
                      )}
                      {r.can_manage && step.key === 'public' && canRetestPublic && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void recheckPublic(r)}
                        >
                          重测公网
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              </section>

              {/* Section 3: Instance Revisions, Task & Blast Radius */}
              <section aria-label="实例与任务记录" className="space-y-2.5">
                <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                  实例与任务记录
                </h3>
                <dl className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background text-(length:--text-xs)">
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <dt className="shrink-0 text-text-secondary">Realm 修订</dt>
                    <dd className="font-mono tabular-nums text-foreground">
                      {r.target_revision ? `目标 r${r.target_revision}` : '尚未发布'}，实测 r
                      {r.observed_revision}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <dt className="shrink-0 text-text-secondary">最近观测</dt>
                    <dd className="tabular-nums text-foreground">{localTime(r.observed_at)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <dt className="shrink-0 text-text-secondary">最近任务</dt>
                    <dd className="flex flex-wrap items-center justify-end gap-2 text-foreground">
                      <span>{taskStateLabel(r.task_state)}</span>
                      {r.task_id && (
                        <Link
                          className="font-medium text-accent hover:underline"
                          to={`/operations/tasks?task=${encodeURIComponent(r.task_id)}`}
                        >
                          查看任务
                        </Link>
                      )}
                    </dd>
                  </div>
                  {r.error_code && (
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="shrink-0 text-text-secondary">任务错误码</dt>
                      <dd className="font-mono text-danger wrap-anywhere">{r.error_code}</dd>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                    <dt className="shrink-0 text-text-secondary">同实例其他线路</dt>
                    <dd className="text-right text-foreground wrap-anywhere">
                      {r.affected.length > 0 ? r.affected.join('、') : '无'}
                    </dd>
                  </div>
                  {r.stopped_at && (
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="shrink-0 text-text-secondary">停用与撤除</dt>
                      <dd className="text-right tabular-nums text-foreground">
                        停用于 {localTime(r.stopped_at)}
                        {r.removed_at ? `，已撤除 ${localTime(r.removed_at)}` : '，等待节点撤除'}
                      </dd>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2">
                    <dt className="shrink-0 text-text-secondary">受管规则 ID</dt>
                    <dd className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-mono text-text-secondary">{r.id}</span>
                      <CopyButton value={r.id} label="复制规则 ID" iconOnly variant="plain" />
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog('');
        }}
      >
        <DialogContent
          title={dialogTitle}
          description={review?.draft.name}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog('')} disabled={busy}>
                取消
              </Button>
              <Button
                variant={dialog === 'delete' ? 'danger' : 'primary'}
                disabled={busy}
                loading={busy}
                onClick={() => void confirmAction()}
              >
                {dialogTitle}
              </Button>
            </>
          }
        >
          {dialog === 'withdraw' && (
            <p className="text-(length:--text-sm) leading-relaxed text-text-secondary">
              后续订阅拉取将立即排除「{review?.draft.name}
              」。入口节点应用撤除任务后，已缓存该入口的客户端也将失去转发路径。
            </p>
          )}
          {dialog === 'delete' && (
            <p className="text-(length:--text-sm) leading-relaxed text-text-secondary">
              将永久删除「{review?.draft.name}
              」的线路记录。已引用此线路的订阅会保留失效引用，重新创建的同名线路须手动重新选入。
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
