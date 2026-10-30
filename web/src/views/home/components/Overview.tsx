import { AlertCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/arc/button/button';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import { MetricCard } from '@/components/arc/metric-card/metric-card';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import {
  attentionItems,
  overviewNodes,
  rangeOptions,
  type TrafficRange,
  trafficRanges,
} from '../mock-data';
import NodeTable from './NodeTable';

const series = [
  { key: 'outbound', label: '出站', color: 'var(--foreground)', area: false },
  { key: 'inbound', label: '入站', color: 'var(--accent)', area: false },
];

export default function Overview() {
  const [range, setRange] = useState<TrafficRange>('week');
  const traffic = trafficRanges[range];
  const online = overviewNodes.filter((node) => node.state !== 'offline').length;
  const regions = new Set(overviewNodes.map((node) => node.region)).size;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-title text-(length:--text-2xl) font-medium">总览</h1>
            <span className="text-(length:--text-xs) text-text-secondary">演示数据</span>
          </div>
          <p className="mt-2 text-text-secondary">
            {overviewNodes.length} 个节点分布在 {regions} 个地区，当前展示 mock 数据。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="流量统计范围"
            value={range}
            onValueChange={(value) => setRange(value as TrafficRange)}
            options={rangeOptions}
          />
          <div className="flex flex-wrap gap-2" aria-describedby="overview-note">
            <Button variant="secondary" disabled>
              生成注册令牌
            </Button>
            <Button disabled>
              <Plus size={16} aria-hidden="true" />
              添加节点
            </Button>
          </div>
        </div>
      </div>

      <div
        className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        role="group"
        aria-label="运行指标"
      >
        <MetricCard
          label="节点"
          value={overviewNodes.length}
          suffix=" 台"
          change={`${online} 在线`}
          changeTone="success"
          context="1 台离线，1 台运行受限"
        />
        <MetricCard
          label="代理服务"
          value={18}
          suffix=" 个"
          change="16 已同步"
          changeTone="success"
          context="2 个待发布"
        />
        <MetricCard
          label={traffic.title}
          value={traffic.value}
          decimals={range === 'day' ? 1 : 2}
          suffix={traffic.unit}
          change={traffic.change}
          context={traffic.context}
        />
        <MetricCard
          label="任务成功率"
          value={98.2}
          decimals={1}
          suffix=" %"
          change="3 个失败"
          changeTone="danger"
          context="近 24 小时 164 个任务"
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="traffic-heading"
          className="min-w-0 rounded-(--radius-panel) border-[0.5px] border-border bg-(--surface) p-5"
        >
          <h2 id="traffic-heading" className="font-medium">
            全网流量
          </h2>
          <p className="mt-1 mb-4 text-(length:--text-xs) text-text-secondary">
            所有节点出站与入站合计，{traffic.bucket}
          </p>
          <LineChart
            label={`${traffic.title}（演示数据）`}
            data={traffic.points}
            series={series}
            unit="GB"
            height={200}
            categoryLabel="时间"
            formatValue={(value) => value.toFixed(1)}
            emptyLabel="此时间范围暂无流量数据"
          />
        </section>
        <section
          aria-labelledby="attention-heading"
          className="min-w-0 rounded-(--radius-panel) border-[0.5px] border-border bg-(--surface) p-5"
        >
          <h2 id="attention-heading" className="font-medium">
            需要关注
          </h2>
          <p className="mt-1 text-(length:--text-xs) text-text-secondary">
            节点状态、配置修订与用量提醒
          </p>
          <ul className="mt-6 space-y-6">
            {attentionItems.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <AlertCircle
                  size={16}
                  aria-hidden="true"
                  className={`mt-1 shrink-0 ${item.tone === 'danger' ? 'text-danger' : 'text-warning'}`}
                />
                <div className="min-w-0 wrap-anywhere">
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 text-(length:--text-xs) leading-relaxed text-text-secondary">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <NodeTable nodes={overviewNodes} />
    </>
  );
}
