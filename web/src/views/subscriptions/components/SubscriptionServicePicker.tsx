import { useState } from 'react';
import type { SubscriptionService } from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Skeleton } from '@/components/arc/skeleton/skeleton';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useDialogFocus } from './useDialogFocus';

const keyOf = (service: SubscriptionService) =>
  `${service.node_id}:${service.engine_id}:${service.service_id}`;

export default function SubscriptionServicePicker({
  candidates,
  selected,
  loaded,
  loading,
  onRetry,
  onClose,
  onAdd,
}: {
  candidates: SubscriptionService[];
  selected: SubscriptionService[];
  loaded: boolean;
  loading: boolean;
  onRetry: () => void;
  onClose: () => void;
  onAdd: (services: SubscriptionService[]) => void;
}) {
  const [groupBy, setGroupBy] = useState('node');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { toast } = useToastStack();
  const focus = useDialogFocus();
  const existing = new Map(selected.map((service) => [keyOf(service), service]));
  const available = candidates.filter(
    (service) =>
      !existing.has(keyOf(service)) || existing.get(keyOf(service))?.status === 'invalid',
  );
  const matches = available.filter((service) =>
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
          : service.protocol
            ? service.protocol.toUpperCase()
            : '协议未知',
      services: [],
    };
    group.services.push(service);
    groups.set(key, group);
  }
  function state(services: SubscriptionService[]): boolean | 'indeterminate' {
    const count = services.filter((service) => picked.has(keyOf(service))).length;
    return count === 0 ? false : count === services.length ? true : 'indeterminate';
  }
  function toggle(services: SubscriptionService[], checked: boolean) {
    const next = new Set(picked);
    for (const service of services) {
      if (checked) next.add(keyOf(service));
      else next.delete(keyOf(service));
    }
    const newCount = available.filter(
      (service) => next.has(keyOf(service)) && !existing.has(keyOf(service)),
    ).length;
    if (selected.length + newCount > 100) {
      toast({
        id: 'subscription-service-limit',
        type: 'error',
        title: '每个订阅最多选择 100 个服务',
        description: `当前已有 ${selected.length} 个服务，请缩小选择范围。`,
      });
      return;
    }
    setPicked(next);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        {...focus}
        title="添加服务"
        className="[--dialog-width:680px]"
        footer={
          <>
            <span
              className="mr-auto text-xs tabular-nums text-[var(--text-secondary)]"
              role="status"
            >
              已选 {picked.size} 个服务
            </span>
            <Button type="button" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!loaded || picked.size === 0}
              onClick={() => onAdd(available.filter((service) => picked.has(keyOf(service))))}
            >
              添加所选服务
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="服务分组方式"
              value={groupBy}
              onValueChange={setGroupBy}
              options={[
                { value: 'node', label: '按节点' },
                { value: 'protocol', label: '按协议' },
              ]}
            />
            <span className="text-xs text-[var(--text-secondary)]">每个订阅最多 100 个服务</span>
          </div>
          <SearchField
            label="搜索服务"
            hideLabel
            placeholder="搜索节点、服务或协议"
            value={query}
            onValueChange={setQuery}
            disabled={!loaded}
          />
          <div aria-busy={loading} className="min-h-48 space-y-4">
            {!loaded && loading && <Skeleton label="正在读取全部可选服务" lines={4} />}
            {!loaded && !loading && (
              <Button type="button" variant="secondary" onClick={onRetry}>
                重新读取服务
              </Button>
            )}
            {loaded && (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-2">
                  <Checkbox
                    label={query.trim() ? '全选搜索结果' : '全选服务'}
                    checked={state(matches)}
                    disabled={matches.length === 0}
                    onCheckedChange={(next) => toggle(matches, next === true)}
                  />
                  <span className="text-xs tabular-nums text-[var(--text-secondary)]">
                    {matches.length} 个可选
                  </span>
                </div>
                {matches.length === 0 && (
                  <p className="py-8 text-center text-sm text-[var(--text-secondary)]">
                    {query.trim()
                      ? '没有匹配的服务'
                      : candidates.length
                        ? '所有可选服务均已添加'
                        : '没有可选服务，请先发布服务并配置公网入口'}
                  </p>
                )}
                {[...groups].map(([key, group]) => (
                  <section
                    key={key}
                    aria-label={group.label}
                    className="space-y-1 [overflow-wrap:anywhere]"
                  >
                    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-[var(--surface-muted)] pr-3">
                      <Checkbox
                        label={group.label}
                        aria-label={`全选${groupBy === 'node' ? '节点' : '协议'} ${group.label}${query.trim() ? '的搜索结果' : ''}`}
                        checked={state(group.services)}
                        onCheckedChange={(next) => toggle(group.services, next === true)}
                      />
                      <span className="shrink-0 text-xs tabular-nums text-[var(--text-secondary)]">
                        {group.services.filter((service) => picked.has(keyOf(service))).length} /{' '}
                        {group.services.length}
                      </span>
                    </div>
                    <ul className="divide-y divide-[var(--border-subtle)] pl-4">
                      {group.services.map((service) => (
                        <li key={keyOf(service)} className="py-2">
                          <Checkbox
                            label={`${service.service_name || service.service_id}${existing.has(keyOf(service)) ? '（重新选择）' : ''}`}
                            description={`${service.node_name || service.node_id} / ${service.engine} / ${service.protocol ? service.protocol.toUpperCase() : '协议未知'}`}
                            checked={picked.has(keyOf(service))}
                            onCheckedChange={(next) => toggle([service], next === true)}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
