import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { getTask, type TaskRecord } from '@/api/tasks';
import type { TelemetryFast } from '@/api/telemetry';
import { calibrateTraffic, gbToBytes } from '@/api/traffic';
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

  const currentTxGB =
    traffic?.tx_bytes !== undefined
      ? (Number(traffic.tx_bytes) / 1000000000).toFixed(2)
      : undefined;
  const currentRxGB =
    traffic?.rx_bytes !== undefined
      ? (Number(traffic.rx_bytes) / 1000000000).toFixed(2)
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

  useServerEvent(
    (event) => {
      if (
        event.type === 'ready' ||
        (event.type === 'change' &&
          event.change.kind === 'tasks' &&
          (!event.change.node_id || event.change.node_id === id))
      )
        void refresh();
    },
    enabled ? [{ kind: 'tasks', node_id: id }] : [],
  );

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
    <section id="traffic-calibration" aria-label="手动校准流量" className="v-card space-y-6">
      <div>
        <h3 className="v-card-title">本周期流量手动校准</h3>
        <p className="v-card-description">
          填写新的累计值，生效后继续累计，不修改历史小时数据。
          {!available && ' 尚未取得有效周期数据，暂不可校准。'}
        </p>
      </div>
      <form
        noValidate
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset
          disabled={!enabled || !available || busy || active}
          className="grid min-w-0 gap-6 sm:grid-cols-2"
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
                  {delta === undefined ? '待填写' : `${delta > 0 ? '+' : ''}${delta.toFixed(6)} GB`}
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
              variant="ghost"
              disabled={!enabled || !available || busy || active}
              onClick={() => {
                setRX((Number(traffic?.rx_bytes) / 1e9).toFixed(6));
                setTX((Number(traffic?.tx_bytes) / 1e9).toFixed(6));
              }}
            >
              填入当前累计值
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={!enabled || !available || busy || active || !valid}
            >
              提交校准
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
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void refresh()}>
              刷新校准状态
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
