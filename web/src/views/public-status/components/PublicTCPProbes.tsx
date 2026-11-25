import { useState } from 'react';
import type { StatusHistory, StatusHistoryRange, StatusNode } from '@/api/public-status';
import { Badge } from '@/components/arc/badge/badge';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import EmptyStates from '@/components/empty-states';
import { TCPProbeRow } from '@/components/tcp-probe-row';
import { ProbeLineChart } from '@/views/nodes/components/TCPProbeQuality';
import { statusRangeLabels } from '../format';
import { statusProbePeriod, statusProbeSlots } from '../probe-slots';
import { statusProbeHistoryBlocks, statusProbeHistorySlots } from '../status-charts';

export default function PublicTCPProbes({
  node,
  snapshotAt,
  range,
  history,
}: {
  node: StatusNode;
  snapshotAt: string;
  range: StatusHistoryRange | 'live';
  history: StatusHistory | null;
}) {
  const [probeView, setProbeView] = useState<'blocks' | 'line'>('blocks');
  const [probeMetric, setProbeMetric] = useState<'ping' | 'loss'>('ping');

  const live = range === 'live';
  const activeLines = history?.lines ?? node.lines;
  const probePeriod = history?.probe_period ?? statusProbePeriod;

  return (
    <section className="v-card min-w-0 space-y-4" aria-label="TCP 线路质量">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="v-card-title">TCP 线路质量</h3>
          <span className="text-(length:--text-xs) text-text-secondary">
            {live ? '最近探测' : history ? `最近 ${statusRangeLabels[range]}` : '快照最近 1 小时'}
          </span>
          {activeLines.length > 0 && <Badge tone="neutral">{activeLines.length} 条线路</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {probeView === 'line' && activeLines.length > 0 && (
            <SegmentedControl
              label="折线图指标"
              value={probeMetric}
              onValueChange={(value) => setProbeMetric(value as 'ping' | 'loss')}
              options={[
                { value: 'ping', label: '连接延迟' },
                { value: 'loss', label: '连接失败率' },
              ]}
            />
          )}
          <SegmentedControl
            label="TCP 线路质量显示方式"
            value={probeView}
            onValueChange={(value) => setProbeView(value as 'blocks' | 'line')}
            options={[
              { value: 'blocks', label: '色块' },
              { value: 'line', label: '折线图' },
            ]}
          />
        </div>
      </div>

      {!activeLines.length ? (
        <EmptyStates
          compact
          headingLevel={3}
          variant="empty"
          title="尚未配置探测线路"
          description="管理员未对该节点启用公开 TCP 线路观测。"
        />
      ) : probeView === 'line' ? (
        <ProbeLineChart
          metric={probeMetric}
          rows={activeLines.map((line) => ({
            key: String(line.slot),
            name: line.name,
            slots: history
              ? statusProbeHistorySlots(line, history.start, history.end, history.probe_period)
              : statusProbeSlots(line, Date.parse(snapshotAt), live).map((s) => ({
                  start: s.start,
                  point: s.point,
                })),
          }))}
          period={probePeriod}
          loaded
          loading={false}
        />
      ) : (
        <ul className="space-y-4">
          {activeLines.map((line) => {
            if (history) {
              const { width, blocks, summary } = statusProbeHistoryBlocks(
                line,
                history.start,
                history.end,
                history.probe_period,
              );
              const current = node.lines.find(
                (candidate) => candidate.slot === line.slot && candidate.name === line.name,
              )?.latest;
              const latest =
                current && (!line.latest || Date.parse(current.at) > Date.parse(line.latest.at))
                  ? current
                  : line.latest;
              return (
                <TCPProbeRow
                  key={line.slot}
                  name={line.name}
                  ping={latest?.ping}
                  loss={summary?.loss}
                  slots={blocks}
                  period={width}
                  loaded
                />
              );
            }
            return (
              <TCPProbeRow
                key={line.slot}
                name={line.name}
                ping={line.latest?.ping}
                loss={line.latest?.loss}
                slots={statusProbeSlots(line, Date.parse(snapshotAt))}
                period={statusProbePeriod}
                loaded
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
