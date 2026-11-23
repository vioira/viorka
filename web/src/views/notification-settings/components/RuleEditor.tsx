import { useCallback, useEffect, useRef, useState } from 'react';
import { type AlertConfig, type AlertRule, type Metric, metricLabels } from '@/api/alerts';
import { listAllNodes, type NodeRecord } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Input } from '@/components/arc/input/input';
import { MultiSelect } from '@/components/arc/multi-select/multi-select';
import { Select } from '@/components/arc/select/select';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function newRule(): AlertRule {
  return {
    id: crypto.randomUUID(),
    name: '',
    metric: 'cpu',
    mode: 'average',
    threshold: 85,
    window_minutes: 5,
    repeat_minutes: 0,
    enabled: true,
    recovery: true,
    nodes: [],
    channels: [],
    template: 'default',
  };
}
function choices(items: Record<string, string>) {
  return Object.entries(items).map(([value, label]) => ({ value, label }));
}
function metricDefaults(metric: Metric): Partial<AlertRule> {
  if (metric === 'offline') return { metric, mode: 'duration', window_minutes: 5, threshold: 0 };
  if (metric === 'monthly') return { metric, mode: 'percent', window_minutes: 0, threshold: 90 };
  return {
    metric,
    mode: 'average',
    window_minutes: 5,
    threshold: metric === 'upload' || metric === 'download' ? 10 : 85,
  };
}
export default function RuleEditor({
  initial,
  config,
  pending,
  save,
  cancel,
}: {
  initial: AlertRule;
  config: AlertConfig;
  pending: boolean;
  save: (r: AlertRule) => void;
  cancel: () => void;
}) {
  const [r, set] = useState(initial);
  const [some, setSome] = useState(r.nodes.length > 0);
  const [nodes, setNodes] = useState<NodeRecord[] | null>(null);
  const request = useRef<AbortController | null>(null);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [, report] = useToastFeedback('error', 'notifications-nodes');
  const loadNodes = useCallback(async () => {
    request.current?.abort();
    const ctl = new AbortController();
    request.current = ctl;
    setLoadingNodes(true);
    try {
      const next = await listAllNodes(ctl.signal);
      if (!ctl.signal.aborted) setNodes(next);
    } catch (e) {
      if (!ctl.signal.aborted) report((e as Error).message);
    } finally {
      if (!ctl.signal.aborted) setLoadingNodes(false);
    }
  }, [report]);
  useEffect(() => {
    if (some) void loadNodes();
    return () => request.current?.abort();
  }, [some, loadNodes]);
  const patch = (v: Partial<AlertRule>) => set((old) => ({ ...old, ...v }));
  const offline = r.metric === 'offline',
    monthly = r.metric === 'monthly',
    builtin = r.id === 'node-offline';
  const unit = monthly
    ? r.mode === 'gb'
      ? 'GB'
      : '%'
    : ['upload', 'download'].includes(r.metric)
      ? 'MB/s'
      : '%';
  const nodeOptions = (nodes ?? []).map((n) => ({ value: n.id, label: n.name }));
  const availableNodes = new Set(nodeOptions.map((n) => n.value));
  for (const id of r.nodes) {
    if (!availableNodes.has(id))
      nodeOptions.push({ value: id, label: nodes ? `已移除的服务器 ${id}` : id });
  }
  const channelOptions = [
    { value: 'in-app', label: '仅站内通知' },
    ...config.channels.map((ch) => ({ value: `channel:${ch.id}`, label: ch.name })),
  ];
  if (initial.channels.length > 1) {
    const names = new Map(config.channels.map((ch) => [ch.id, ch.name]));
    channelOptions.push({
      value: 'original',
      label: initial.channels.map((id) => names.get(id) ?? id).join('、'),
    });
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ ...r, nodes: some ? r.nodes : [] });
      }}
    >
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <Input
          required
          maxLength={100}
          label="规则名称"
          value={r.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="监控项"
            value={r.metric}
            disabled={builtin}
            options={choices(metricLabels)}
            onValueChange={(m) => patch(metricDefaults(m as Metric))}
          />
          {!offline && (
            <Select
              label={monthly ? '阈值类型' : '触发方式'}
              value={r.mode}
              options={choices(
                monthly
                  ? { percent: '周期额度百分比', gb: '累计流量' }
                  : { average: '窗口平均值超过阈值', all: '窗口样本均超过阈值' },
              )}
              onValueChange={(mode) => patch({ mode: mode as AlertRule['mode'] })}
            />
          )}
          {!offline && (
            <Input
              label={`阈值（${unit}）`}
              type="number"
              step="any"
              min={monthly ? '0.000001' : '0'}
              required
              max={!monthly && unit === '%' ? 100 : undefined}
              value={Number.isFinite(r.threshold) ? r.threshold : ''}
              onChange={(e) => patch({ threshold: e.target.valueAsNumber })}
            />
          )}
          {!monthly &&
            (builtin ? (
              <Select
                label="持续离线时长"
                options={[5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 60].map((n) => ({
                  value: String(n),
                  label: `${n} 分钟`,
                }))}
                value={String(r.window_minutes)}
                onValueChange={(v) => patch({ window_minutes: Number(v) })}
              />
            ) : (
              <Input
                label={offline ? '持续离线时长（分钟）' : '统计窗口（分钟）'}
                type="number"
                min={1}
                max={offline ? 1440 : 60}
                required
                value={Number.isFinite(r.window_minutes) ? r.window_minutes : ''}
                onChange={(e) => patch({ window_minutes: e.target.valueAsNumber })}
              />
            ))}
          <Input
            label="重复提醒间隔（分钟）"
            description="0 表示每次异常只提醒一次。"
            type="number"
            min={0}
            max={43200}
            required
            value={Number.isFinite(r.repeat_minutes) ? r.repeat_minutes : ''}
            onChange={(e) => patch({ repeat_minutes: e.target.valueAsNumber })}
          />
        </div>
        <Select
          label="服务器范围"
          value={some ? 'some' : 'all'}
          options={choices({ all: '全部服务器（含后续新增）', some: '指定服务器' })}
          onValueChange={(v) => setSome(v === 'some')}
        />
        {some && (
          <div className="space-y-2">
            <MultiSelect
              label="服务器"
              value={r.nodes}
              options={nodeOptions}
              disabled={pending || !nodes || !nodeOptions.length}
              placeholder={
                !nodes
                  ? loadingNodes
                    ? '正在读取服务器…'
                    : '服务器尚未读取'
                  : nodeOptions.length
                    ? '选择服务器'
                    : '暂无服务器'
              }
              onValueChange={(nodes) => patch({ nodes })}
            />
            {!loadingNodes && !nodes && (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => void loadNodes()}
              >
                重新读取服务器
              </Button>
            )}
          </div>
        )}
        <Select
          label="通知渠道"
          description="站内通知始终启用"
          options={channelOptions}
          value={
            r.channels.length > 1
              ? 'original'
              : r.channels.length
                ? `channel:${r.channels[0]}`
                : 'in-app'
          }
          onValueChange={(value) => {
            if (value === 'original') patch({ channels: initial.channels });
            else if (value === 'in-app') patch({ channels: [] });
            else if (value.startsWith('channel:'))
              patch({ channels: [value.slice('channel:'.length)] });
          }}
        />
        <Select
          label="通知模板"
          value={r.template}
          options={config.templates.map((t) => ({ value: t.id, label: t.name }))}
          onValueChange={(template) => patch({ template })}
        />
        <Checkbox
          label="启用规则"
          checked={r.enabled}
          onCheckedChange={(v) => patch({ enabled: v === true })}
        />
        <Checkbox
          label="恢复时发送通知"
          checked={r.recovery}
          onCheckedChange={(v) => patch({ recovery: v === true })}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending} disabled={some && (!nodes || !r.nodes.length)}>
            保存规则
          </Button>
          <Button type="button" variant="secondary" onClick={cancel}>
            取消
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
