import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { SubscriptionService } from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import InitialSkeleton from '@/components/initial-skeleton';

const keyOf = (service: SubscriptionService) =>
  `${service.node_id}:${service.engine_id}:${service.service_id}`;
export default function SubscriptionServicePicker({
  candidates,
  selected,
  loaded,
  loading,
  query,
  onQuery,
  more,
  onMore,
  onRetry,
  onToggle,
}: {
  candidates: SubscriptionService[];
  selected: SubscriptionService[];
  loaded: boolean;
  loading: boolean;
  query: string;
  onQuery: (query: string) => void;
  more: boolean;
  onMore: () => void;
  onRetry: () => void;
  onToggle: (services: SubscriptionService[], checked: boolean) => void;
}) {
  const [groupBy, setGroupBy] = useState('node');
  const picked = new Set(selected.filter((s) => s.status !== 'invalid').map(keyOf));
  const [entryType, setEntryType] = useState('all');
  const matches = candidates.filter(
    (s) => entryType === 'all' || (s.entry_type ?? 'direct') === entryType,
  );
  const groups = new Map<string, { label: string; services: SubscriptionService[] }>();
  for (const service of matches) {
    const key = groupBy === 'node' ? service.node_id : service.protocol;
    const group = groups.get(key) ?? {
      label:
        groupBy === 'node'
          ? service.node_name || service.node_id
          : service.protocol.toUpperCase() || '协议未知',
      services: [],
    };
    group.services.push(service);
    groups.set(key, group);
  }
  function state(services: SubscriptionService[]): boolean | 'indeterminate' {
    const count = services.filter((service) => picked.has(keyOf(service))).length;
    return count === 0 ? false : count === services.length ? true : 'indeterminate';
  }
  return (
    <section aria-label="可选服务" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">选择入口</h3>
        <Button
          loading={loading}
          type="button"
          size="sm"
          variant="secondary"
          disabled={loading}
          onClick={onRetry}
        >
          <RefreshCw size={16} aria-hidden="true" />
          刷新服务
        </Button>
      </div>
      <SearchField
        label="搜索服务"
        hideLabel
        placeholder="搜索节点、服务或协议"
        value={query}
        onValueChange={onQuery}
      />
      <SegmentedControl
        label="入口类型"
        value={entryType}
        onValueChange={setEntryType}
        options={[
          { value: 'all', label: '全部入口' },
          { value: 'direct', label: '直连' },
          { value: 'relay', label: '中转' },
        ]}
      />
      <SegmentedControl
        label="服务分组方式"
        value={groupBy}
        onValueChange={setGroupBy}
        options={[
          { value: 'node', label: '按节点' },
          { value: 'protocol', label: '按协议' },
        ]}
      />
      <div aria-busy={loading} className="min-h-64 max-h-[32rem] space-y-4 overflow-y-auto pr-1">
        {!loaded && loading && <InitialSkeleton label="正在读取可选服务" lines={5} />}
        {!loaded && !loading && (
          <p className="py-8 text-sm text-(--text-secondary)">可选服务尚未读取，请刷新服务。</p>
        )}
        {loaded && (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-(--border-subtle) pb-3">
              <Checkbox
                label="全选已显示服务"
                checked={state(matches)}
                disabled={!matches.length}
                onCheckedChange={(value) => onToggle(matches, value === true)}
              />
              <span className="text-xs tabular-nums text-(--text-secondary)">
                {matches.length} 个服务
              </span>
            </div>
            {matches.length === 0 && (
              <p className="py-8 text-sm text-(--text-secondary)">
                {query || entryType !== 'all'
                  ? '本页没有匹配的入口'
                  : '没有可选服务，请先发布服务并配置公网入口。'}
              </p>
            )}
            {[...groups].map(([key, group]) => (
              <section
                key={key}
                aria-label={group.label}
                className="space-y-2 [overflow-wrap:anywhere]"
              >
                <div className="flex items-center justify-between gap-3">
                  <Checkbox
                    label={group.label}
                    aria-label={`选择 ${group.label} 当前已显示的服务`}
                    checked={state(group.services)}
                    onCheckedChange={(value) => onToggle(group.services, value === true)}
                  />
                  <span className="text-xs tabular-nums text-(--text-secondary)">
                    {group.services.filter((s) => picked.has(keyOf(s))).length} /{' '}
                    {group.services.length}
                  </span>
                </div>
                <ul className="divide-y divide-(--border-subtle) pl-4">
                  {group.services.map((service) => (
                    <li key={keyOf(service)} className="py-2">
                      <Checkbox
                        label={service.service_name || service.service_id}
                        description={
                          service.entry_type === 'relay'
                            ? `中转 / ${service.landing_name} / 上次公网验证 ${service.verified_at ? new Date(service.verified_at).toLocaleString() : '未知'}`
                            : `直连 / ${service.node_name || service.node_id} / ${service.engine} / ${service.protocol.toUpperCase() || '协议未知'}`
                        }
                        checked={picked.has(keyOf(service))}
                        onCheckedChange={(value) => onToggle([service], value === true)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {more && (
              <Button type="button" variant="secondary" disabled={loading} onClick={onMore}>
                加载更多服务
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
