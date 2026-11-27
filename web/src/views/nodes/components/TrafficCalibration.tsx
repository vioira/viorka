import { ClipboardPaste, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { getTask, parseTask, type TaskRecord } from '@/api/tasks';
import type { TelemetryFast } from '@/api/telemetry';
import { calibrateTraffic, gbToBytes } from '@/api/traffic';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
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
  const formId = useId();
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const [rx, setRX] = useState('');
  const [tx, setTX] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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

  const currentTxGB =
    traffic?.tx_bytes !== undefined
      ? (Number(traffic.tx_bytes) / 1000000000).toFixed(2)
      : undefined;
  const currentRxGB =
    traffic?.rx_bytes !== undefined
      ? (Number(traffic.rx_bytes) / 1000000000).toFixed(2)
      : undefined;

  const active = !!task && ['queued', 'dispatched', 'accepted', 'running'].includes(task.state);

  const sequence = useRef(0);
  function apply(next: TaskRecord) {
    if (!task || task.id !== next.id) return;
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
  }
  async function refresh() {
    if (!task) return;
    const version = ++sequence.current;
    setRefreshing(true);
    try {
      const next = await getTask(task.id);
      if (mounted.current && version === sequence.current) apply(next);
    } catch (error) {
      toast({
        id: `traffic-calibration-read-${id}`,
        type: 'error',
        title: '读取校准任务失败',
        description: error instanceof Error ? error.message : '请重新读取任务。',
      });
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }

  useServerEvent(
    (event) => {
      if (!enabled || !task) return;
      if (event.type === 'ready') {
        void refresh();
        return;
      }
      if (
        event.type !== 'change' ||
        event.change.kind !== 'tasks' ||
        (event.change.task_id && event.change.task_id !== task.id)
      )
        return;
      if (event.change.task?.id === task.id) {
        sequence.current++;
        setRefreshing(false);
        apply(parseTask(event.change.task));
      } else void refresh();
    },
    enabled && task ? [{ kind: 'tasks', task_id: task.id }] : [],
  );

  const refreshLatest = useRef(refresh);
  refreshLatest.current = refresh;
  const selectedTask = task?.id;
  useEffect(() => {
    if (enabled && selectedTask) void refreshLatest.current();
  }, [selectedTask, enabled]);

  async function submit() {
    if (!enabled || !available || !traffic || submitting.current || active) return;
    submitting.current = true;
    setBusy(true);
    try {
      const down = gbToBytes(rx),
        up = gbToBytes(tx);
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
      sequence.current++;
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

  const valid = /^\d+(\.\d{1,6})?$/.test(rx) && /^\d+(\.\d{1,6})?$/.test(tx);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button id="traffic-calibration" type="button" variant="secondary" size="sm">
          <SlidersHorizontal size={14} aria-hidden="true" />
          校准本周期流量
        </Button>
      </DialogTrigger>
      <DialogContent
        title="本周期流量手动校准"
        description="填写本周期新的收发累计值。校准生效后继续累计，历史采样保持原值。"
        footer={
          <Button
            type="submit"
            form={formId}
            loading={busy}
            disabled={!enabled || !available || busy || active || !valid}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            提交校准
          </Button>
        }
      >
        <form
          id={formId}
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void submit();
          }}
        >
          <fieldset
            disabled={!enabled || !available || busy || active}
            className="grid min-w-0 gap-6"
          >
            {(
              [
                ['接收（RX / 下行）', traffic?.rx_bytes, currentRxGB, rx, setRX, 'var(--accent)'],
                ['发送（TX / 上行）', traffic?.tx_bytes, currentTxGB, tx, setTX, 'var(--series-1)'],
              ] as const
            ).map(([label, bytes, current, value, setValue, color]) => {
              const delta =
                bytes !== undefined && /^\d+(\.\d{1,6})?$/.test(value)
                  ? Number(value) - Number(bytes) / 1e9
                  : undefined;
              return (
                <div key={label} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-medium" style={{ color }}>
                      {label}
                    </h4>
                    <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                      当前累计 {current === undefined ? '未知' : `${current} GB`}
                    </span>
                  </div>
                  <Input
                    label={`${label}目标累计值（GB）`}
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="填写目标累计值"
                  />
                  <p className="min-h-5 text-(length:--text-xs) text-text-secondary tabular-nums">
                    调整量：
                    {delta === undefined
                      ? '待填写'
                      : `${delta > 0 ? '+' : ''}${delta.toFixed(6)} GB`}
                  </p>
                </div>
              );
            })}
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
            <p className="text-(length:--text-xs) text-text-secondary">
              {traffic
                ? `当前周期始于 ${new Date(traffic.month_start).toLocaleString('zh-CN')}`
                : '周期未知'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={!enabled || !available || busy || active}
                onClick={() => {
                  setRX((Number(traffic?.rx_bytes) / 1e9).toFixed(6));
                  setTX((Number(traffic?.tx_bytes) / 1e9).toFixed(6));
                }}
              >
                <ClipboardPaste size={16} aria-hidden="true" />
                填入当前累计值
              </Button>
            </div>
          </div>
          {task && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-(length:--text-xs)"
            >
              <div className="min-w-0 space-y-1">
                <p
                  className={
                    task.state === 'succeeded'
                      ? 'text-success'
                      : task.state === 'failed'
                        ? 'text-danger'
                        : 'text-text-secondary'
                  }
                >
                  {(
                    {
                      queued: '等待派发',
                      dispatched: '已派发，等待接收',
                      accepted: '节点已接收',
                      running: '正在校准',
                      succeeded: '已确认生效',
                      failed: '执行失败',
                    } as Record<string, string>
                  )[task.state] ?? task.state}
                </p>
                <p className="wrap-anywhere text-text-secondary">任务 {task.id}</p>
              </div>
              <Button
                loading={refreshing}
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw size={16} aria-hidden="true" />
                刷新校准状态
              </Button>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
