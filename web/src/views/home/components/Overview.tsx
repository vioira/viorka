import { Activity, Bell, Plus, Server } from 'lucide-react';
import { Button } from '@/components/arc/button/button';
import { EmptyState } from '@/components/arc/empty-state/empty-state';

export default function Overview() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-title text-(length:--text-2xl) font-medium">总览</h1>
          <p className="mt-2 text-text-secondary">查看节点、代理服务与任务的运行情况。</p>
        </div>
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
      <p id="overview-note" className="text-(length:--text-xs) text-text-secondary">
        总览数据尚未接入，节点注册入口将在后续开放。
      </p>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="traffic-heading"
          className="min-w-0 rounded-(--radius-panel) border-[0.5px] border-border bg-(--surface) p-5"
        >
          <h2 id="traffic-heading" className="font-medium">
            全网流量
          </h2>
          <p className="mt-1 text-(length:--text-xs) text-text-secondary">
            所有节点的出站与入站流量
          </p>
          <EmptyState
            icon={<Activity size={24} />}
            title="流量统计尚未接入"
            description="接入节点流量指标后，这里将展示流量趋势。"
          />
        </section>
        <section
          aria-labelledby="attention-heading"
          className="min-w-0 rounded-(--radius-panel) border-[0.5px] border-border bg-(--surface) p-5"
        >
          <h2 id="attention-heading" className="font-medium">
            需要关注
          </h2>
          <p className="mt-1 text-(length:--text-xs) text-text-secondary">节点状态与任务异常</p>
          <EmptyState
            icon={<Bell size={24} />}
            title="运行状态尚未接入"
            description="当前无法判断节点是否在线或是否存在异常。"
          />
        </section>
      </div>
      <section
        aria-labelledby="nodes-heading"
        className="min-w-0 rounded-(--radius-panel) border-[0.5px] border-border bg-(--surface) p-5"
      >
        <h2 id="nodes-heading" className="font-medium">
          节点
        </h2>
        <EmptyState
          icon={<Server size={24} />}
          title="节点列表尚未接入"
          description="节点列表接入后，可在这里查看节点状态、引擎与资源用量。"
        />
      </section>
    </>
  );
}
