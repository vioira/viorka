import { Check, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { listRelayLandings } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { SearchField } from '@/components/arc/search-field/search-field';
import { endpointText } from '@/components/proxy/relay-meta';
import { useSubscriptionPages } from '@/views/subscriptions/components/useSubscriptionPages';

export default function RelayLandingPicker({
  engine,
  service,
  label,
  onChange,
}: {
  engine: string;
  service: string;
  label: string;
  onChange: (engine: string, service: string) => void;
}) {
  const [query, setQuery] = useState('');
  const request = useCallback(
    (after: string, signal: AbortSignal) => listRelayLandings(after, query, signal),
    [query],
  );
  const page = useSubscriptionPages(query, request, 'relay-landing-list', '未能读取可用落地服务');
  const items = page.items ?? [];
  const selectedKey = engine && service ? `${engine}/${service}` : '';
  const selectedInList = items.some((s) => `${s.engine_id}/${s.service_id}` === selectedKey);

  return (
    <div className="space-y-3">
      <SearchField
        hideLabel
        label="搜索落地服务"
        placeholder="按节点或服务名称搜索落地服务"
        value={query}
        onValueChange={setQuery}
      />

      {!page.items && !page.loading ? (
        <div className="flex items-center justify-between gap-3 rounded-(--radius-control) border-[1px] border-border bg-background px-3.5 py-3 text-(length:--text-xs) text-text-secondary">
          <span>落地服务列表尚未读取</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => void page.load()}>
            <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
            重试读取
          </Button>
        </div>
      ) : items.length === 0 && !selectedKey ? (
        <div className="rounded-(--radius-control) border-[1px] border-border bg-background px-4 py-5 text-center text-(length:--text-xs) text-text-secondary">
          {page.loading
            ? '正在读取可用落地服务…'
            : query
              ? '没有匹配的落地服务'
              : '暂无可选落地服务。请先发布并运行具备导出权限的 VLESS TCP REALITY 服务。'}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label="选择落地代理服务"
          className="max-h-56 divide-y-[1px] divide-border-subtle overflow-y-auto rounded-(--radius-control) border-[1px] border-border bg-surface"
        >
          {selectedKey && !selectedInList && (
            <button
              type="button"
              role="radio"
              aria-checked
              onClick={() => onChange(engine, service)}
              className="flex w-full items-start justify-between gap-3 bg-surface-muted px-3.5 py-2.5 text-left"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-(length:--text-sm) font-medium text-foreground">
                  {label || service}
                </p>
                <p className="text-(length:--text-xs) text-text-secondary">当前已选落地服务</p>
              </div>
              <Check
                size={16}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0 text-accent"
                aria-hidden="true"
              />
            </button>
          )}
          {items.map((item) => {
            const key = `${item.engine_id}/${item.service_id}`;
            const active = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(item.engine_id, item.service_id)}
                className={`flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors ${
                  active ? 'bg-surface-muted' : 'bg-surface hover:bg-background'
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-(length:--text-sm) font-medium text-foreground">
                      {item.service_name}
                    </span>
                    <Badge size="sm" tone="neutral">
                      {item.engine}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-(length:--text-xs) text-text-secondary">
                    <span className="truncate">{item.node_name}</span>
                    {item.public_host && item.public_port > 0 && (
                      <span className="font-mono tabular-nums">
                        {endpointText({ host: item.public_host, port: item.public_port })}
                      </span>
                    )}
                  </div>
                </div>
                {active && (
                  <Check
                    size={16}
                    strokeWidth={1.75}
                    className="mt-0.5 shrink-0 text-accent"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {page.cursor && (
        <Button
          variant="secondary"
          type="button"
          size="sm"
          disabled={page.loading}
          loading={page.loading}
          onClick={() => void page.load(page.cursor)}
        >
          加载更多落地服务
        </Button>
      )}
    </div>
  );
}
