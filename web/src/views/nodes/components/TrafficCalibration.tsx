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
  return (
    <section aria-label="手动校准流量" className="space-y-4 border-t-[0.5px] border-border pt-6">
      <h3 className="font-medium">手动校准本周期流量</h3>
      <p className="text-(length:--text-xs) text-text-secondary">
        填写期望的累计值，生效后继续叠加实际流量。不会修改已有历史桶。
        {!available && '尚未取得有效周期数据，暂不可校准。'}
      </p>
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
          className="grid min-w-0 gap-4 sm:grid-cols-2"
        >
          <Input
            label="已用上行流量（GiB）"
            inputMode="decimal"
            value={tx}
            onChange={(e) => setTX(e.target.value)}
          />
          <Input
            label="已用下行流量（GiB）"
            inputMode="decimal"
            value={rx}
            onChange={(e) => setRX(e.target.value)}
          />
        </fieldset>
        <p
          role="status"
          className="min-h-5 wrap-anywhere text-(length:--text-xs) text-text-secondary"
        >
          {task
            ? `任务 ${task.id}：${task.state === 'succeeded' ? '已生效' : task.state === 'failed' ? '未确认成功' : '等待 Agent 完成'}`
            : '尚未提交校准任务。'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="secondary"
            loading={busy}
            disabled={!enabled || !available || !traffic || busy || active}
          >
            校准周期流量
          </Button>
          <Button type="button" variant="ghost" disabled={!task || busy} onClick={refresh}>
            刷新校准任务
          </Button>
        </div>
      </form>
    </section>
  );
}
