import { useState } from 'react';
import type { SubscriptionService } from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Skeleton } from '@/components/arc/skeleton/skeleton';

const keyOf = (service: SubscriptionService) =>
  `${service.node_id}:${service.engine_id}:${service.service_id}`;
export default function SubscriptionServicePicker({
  candidates,
  selected,
  loaded,
  loading,
  onRetry,
  onToggle,
}: {
  candidates: SubscriptionService[];
  selected: SubscriptionService[];
  loaded: boolean;
  loading: boolean;
  onRetry: () => void;
  onToggle: (services: SubscriptionService[], checked: boolean) => void;
}) {
  const [groupBy, setGroupBy] = useState('node');
  const [query, setQuery] = useState('');
  const picked = new Set(selected.filter((s) => s.status !== 'invalid').map(keyOf));
  const matches = candidates.filter((service) =>
    `${service.node_name} ${service.node_id} ${service.service_name} ${service.service_id} ${service.engine} ${service.protocol}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
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
        <h3 className="text-sm font-medium">选择服务</h3>
        <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={onRetry}>
          刷新服务
        </Button>
      </div>
      <SearchField
        label="搜索服务"
        hideLabel
        placeholder="搜索节点、服务或协议"
        value={query}
        onValueChange={setQuery}
        disabled={!loaded}
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
        {!loaded && loading && <Skeleton label="正在读取全部可选服务" lines={5} />}
        {!loaded && !loading && (
          <p className="py-8 text-sm text-(--text-secondary)">可选服务尚未读取，请刷新服务。</p>
        )}
        {loaded && (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-(--border-subtle) pb-3">
              <Checkbox
                label={query ? '全选搜索结果' : '全选服务'}
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
                {query ? '没有匹配的服务' : '没有可选服务，请先发布服务并配置公网入口。'}
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
                    aria-label={`全选 ${group.label}`}
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
                        description={`${service.node_name || service.node_id} / ${service.engine} / ${service.protocol.toUpperCase() || '协议未知'}`}
                        checked={picked.has(keyOf(service))}
                        onCheckedChange={(value) => onToggle([service], value === true)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
