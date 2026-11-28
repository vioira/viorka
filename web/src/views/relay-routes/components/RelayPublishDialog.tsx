import { AlertTriangle, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import { getRelay, type RelayRoute, submitRelay } from '@/api/relays';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import RelayChainStrip from '@/components/proxy/RelayChainStrip';

export default function RelayPublishDialog({
  route,
  onClose,
  onSubmitted,
  returnFocus,
}: {
  route: RelayRoute;
  onClose: () => void;
  onSubmitted: () => void;
  returnFocus: () => void;
}) {
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const [review, setReview] = useState(route);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const requestKey = useRef('');
  const base = review.publish_base;
  const path = review.draft;

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      if (stale || !base) {
        const latest = await getRelay(review.id, new AbortController().signal);
        if (latest.cleanup_only || !latest.can_manage) {
          onClose();
          return;
        }
        setReview(latest);
        requestKey.current = '';
        setStale(false);
        return;
      }
      requestKey.current ||= crypto.randomUUID();
      await submitRelay(review, 'publish', requestKey.current, session);
      toast({ type: 'success', title: '已提交线路发布任务' });
      onSubmitted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (err.code === 'relay_revision_conflict') setStale(true);
        else if (err.code === 'relay_landing_changed') onClose();
      }
      toast({
        id: 'relay-publish',
        type: 'error',
        title: '未能发布线路',
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        title="审查线路发布"
        description={path.name}
        className="[--dialog-width:580px]"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus();
        }}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              返回
            </Button>
            <Button loading={busy} disabled={busy} onClick={() => void submit()}>
              <Send size={15} strokeWidth={1.75} aria-hidden="true" />
              {stale || !base
                ? '重新读取发布信息'
                : base.starts_realm
                  ? '启动 Realm 并发布'
                  : '确认发布'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <RelayChainStrip
            compact
            entryName={review.entry_name}
            entryOnline={review.online}
            publicEndpoint={path.public}
            listenEndpoint={path.listen}
            dialEndpoint={path.dial}
            landingName={path.landing_name}
            landingRevision={path.landing_revision}
          />

          <section
            aria-label="实例影响范围"
            className="space-y-2.5 rounded-(--radius-control) border-[1px] border-border bg-background p-3.5 text-(length:--text-xs)"
          >
            <div className="flex items-start gap-2 text-foreground">
              <AlertTriangle
                size={15}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0 text-warning"
                aria-hidden="true"
              />
              <p className="leading-relaxed">
                {!base
                  ? '入口实例当前有任务待完成，可稍后点击重新读取发布信息。'
                  : base.starts_realm
                    ? '发布将启动入口节点上的整个 Realm 实例，并启用其中已发布的转发规则。'
                    : '发布会重新应用整个 Realm 实例配置，已有转发连接可能短暂中断。'}
              </p>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t-[1px] border-border-subtle pt-2.5 text-text-secondary">
              <span>同实例其他中转线路</span>
              <span className="text-foreground wrap-anywhere">
                {review.affected.length > 0 ? review.affected.join('、') : '无'}
              </span>
            </div>
          </section>

          <p className="text-(length:--text-xs) leading-relaxed text-text-secondary">
            Realm 确认应用并运行后，Panel 将自动对公网入口发起 TCP 检测，检测通过后可供订阅选择。
            {session.user.role === 'admin' &&
              ' 请确认该公网端口已分配给此入口节点，发布即授权检测该端口。'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
