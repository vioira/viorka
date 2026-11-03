import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { getTask, type TaskRecord } from '@/api/tasks';
import type { TelemetryFast } from '@/api/telemetry';
import { calibrateTraffic, gibToBytes } from '@/api/traffic';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useServerEvent } from '@/hooks/realtime';

export default function TrafficCalibration({
  id,
  traffic,
  enabled,
}: {
  id: string;
  traffic?: TelemetryFast['traffic'];
  enabled: boolean;
}) {
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const [rx, setRX] = useState('');
  const [tx, setTX] = useState('');
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<TaskRecord>();
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const mounted = useRef(true);
  const submitting = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const available =
    !!traffic &&
    traffic.rx_bytes !== undefined &&
    traffic.tx_bytes !== undefined &&
    !traffic.quality.includes('unknown');

  const currentTxGiB =
    traffic?.tx_bytes !== undefined
      ? (Number(traffic.tx_bytes) / 1073741824).toFixed(2)
      : undefined;
  const currentRxGiB =
    traffic?.rx_bytes !== undefined
      ? (Number(traffic.rx_bytes) / 1073741824).toFixed(2)
      : undefined;

  const active = !!task && ['queued', 'dispatched', 'accepted', 'running'].includes(task.state);

  async function refresh() {
    if (!task) return;
    try {
      const next = await getTask(task.id);
      if (!mounted.current) return;
      setTask(next);
      if (['succeeded', 'failed'].includes(next.state)) pending.current = undefined;
      if (next.state === 'succeeded' && task.state !== 'succeeded')
        toast({
          id: `traffic-calibration-${id}`,
          type: 'success',
          title: '流量校准已生效',
          description: 'Agent 已保存校准值，后续采样将继续累计。',
        });
      if (next.state === 'failed' && task.state !== 'failed')
        toast({
          id: `traffic-calibration-${id}`,
          type: 'error',
          title: '流量校准未确认成功',
          description:
            next.error_code === 'traffic_period_changed'
              ? '计费周期已变化或暂无有效账本，请重新同步节点流量后校准。'
              : '请重新同步节点流量并核对周期，再决定是否重新校准。',
        });
    } catch (error) {
      toast({
        id: `traffic-calibration-read-${id}`,
        type: 'error',
        title: '读取校准任务失败',
        description: error instanceof Error ? error.message : '请重新读取任务。',
      });
    }
  }

  useServerEvent((event) => {
    if (
      event.type === 'ready' ||
      (event.type === 'change' &&
        event.change.kind === 'tasks' &&
        (!event.change.node_id || event.change.node_id === id))
    )
      void refresh();
  });

  async function submit() {
    if (!enabled || !available || !traffic || submitting.current || active) return;
    submitting.current = true;
    setBusy(true);
    try {
      const down = gibToBytes(rx),
        up = gibToBytes(tx);
      const signature = JSON.stringify([traffic.month_start, down, up]);
      if (pending.current?.signature !== signature)
        pending.current = { signature, key: crypto.randomUUID() };
      const next = await calibrateTraffic(
        session,
        id,
        pending.current.key,
        traffic.month_start,
        down,
        up,
      );
      if (!mounted.current) return;
      setTask(next);
      toast({
        id: `traffic-calibration-${id}`,
        type: 'success',
        title: '已提交流量校准任务',
        description: '等待 Agent 执行；提交成功不代表校准已生效。',
      });
    } catch (error) {
      if (mounted.current)
        toast({
          id: `traffic-calibration-${id}`,
          type: 'error',
          title: '提交流量校准失败',
          description: error instanceof Error ? error.message : '请重试。',
        });
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  // Calculate live delta difference
  const numTx = parseFloat(tx);
  const numRx = parseFloat(rx);
  const diffTx =
    currentTxGiB !== undefined && !Number.isNaN(numTx)
      ? (numTx - parseFloat(currentTxGiB)).toFixed(2)
      : null;
  const diffRx =
    currentRxGiB !== undefined && !Number.isNaN(numRx)
      ? (numRx - parseFloat(currentRxGiB)).toFixed(2)
      : null;

  return (
    <section
      aria-label="手动校准流量"
      className="space-y-4 rounded-lg border border-border bg-surface p-5"
    >
      <div className="space-y-1">
        <h3 className="text-(length:--text-base) font-medium text-foreground">
          本周期流量手动校准
        </h3>
        <p className="text-(length:--text-xs) text-text-secondary">
          填写期望的累计值，生效后继续叠加实际流量。不会修改已有历史小时桶。
          {!available && ' 尚未取得有效周期数据，暂不可校准。'}
        </p>
      </div>

      {available && (
        <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface-muted/30 p-3 sm:grid-cols-3">
          <div className="space-y-1">
            <span className="text-(length:--text-xs) font-medium text-text-secondary">
              当前账期已累计
            </span>
            <div className="font-mono text-(length:--text-sm) font-medium tabular-nums text-foreground">
              TX {currentTxGiB ?? '--'} / RX {currentRxGiB ?? '--'} GiB
            </div>
            <p className="text-[11px] text-text-secondary">
              账期始于{' '}
              {traffic?.month_start
                ? new Date(traffic.month_start).toLocaleDateString('zh-CN')
                : '--'}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-(length:--text-xs) font-medium text-text-secondary">
              校准后新基准
            </span>
            <div className="font-mono text-(length:--text-sm) font-medium tabular-nums text-foreground">
              TX {tx || '--'} / RX {rx || '--'} GiB
            </div>
            <p className="text-[11px] text-text-secondary">以此数值为底继续累加</p>
          </div>

          <div className="space-y-1">
            <span className="text-(length:--text-xs) font-medium text-text-secondary">
              实时补偿量预览
            </span>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {diffTx !== null ? (
                <span
                  className={`rounded-xs px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                    parseFloat(diffTx) > 0
                      ? 'bg-success-muted text-success'
                      : parseFloat(diffTx) < 0
                        ? 'bg-warning-muted text-warning'
                        : 'bg-surface text-text-secondary'
                  }`}
                >
                  TX: {parseFloat(diffTx) > 0 ? `+${diffTx}` : diffTx} GiB
                </span>
              ) : (
                <span className="text-[11px] text-text-secondary">TX 无变动</span>
              )}
              {diffRx !== null ? (
                <span
                  className={`rounded-xs px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                    parseFloat(diffRx) > 0
                      ? 'bg-success-muted text-success'
                      : parseFloat(diffRx) < 0
                        ? 'bg-warning-muted text-warning'
                        : 'bg-surface text-text-secondary'
                  }`}
                >
                  RX: {parseFloat(diffRx) > 0 ? `+${diffRx}` : diffRx} GiB
                </span>
              ) : (
                <span className="text-[11px] text-text-secondary">RX 无变动</span>
              )}
            </div>
          </div>
        </div>
      )}

      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset
          disabled={!enabled || !available || !traffic || busy || active}
          className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <Input
            label="已用上行流量（GiB）"
            inputMode="decimal"
            placeholder={currentTxGiB ?? '0.00'}
            value={tx}
            onChange={(e) => setTX(e.target.value)}
          />
          <Input
            label="已用下行流量（GiB）"
            inputMode="decimal"
            placeholder={currentRxGiB ?? '0.00'}
            value={rx}
            onChange={(e) => setRX(e.target.value)}
          />
        </fieldset>

        {task && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-(length:--text-xs)">
            <span
              className={`h-2 w-2 rounded-full ${
                task.state === 'succeeded'
                  ? 'bg-success'
                  : task.state === 'failed'
                    ? 'bg-danger'
                    : 'bg-warning animate-pulse'
              }`}
            />
            <span className="font-mono text-text-secondary">任务 {task.id}</span>
            <span className="font-medium text-foreground">
              {task.state === 'succeeded'
                ? '已确认生效'
                : task.state === 'failed'
                  ? '执行失败'
                  : '正在派发并执行…'}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-(length:--text-xs) text-text-secondary">
            提交后将向 Agent 派发校准任务，需要等待 Agent 确认执行结果。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="secondary"
              loading={busy}
              disabled={!enabled || !available || !traffic || busy || active || (!tx && !rx)}
            >
              校准周期流量
            </Button>
            {task && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void refresh()}>
                刷新校准状态
              </Button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
