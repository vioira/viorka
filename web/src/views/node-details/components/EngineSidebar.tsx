import type { EngineSummary } from '@/api/engines';
import { engineNames, engineRuntimeStatus } from '@/api/engines';
import type { RelayRoute } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { isRelayAttention } from '@/components/proxy/relay-meta';

export interface EngineSidebarProps {
  engines: EngineSummary[] | null;
  relays?: RelayRoute[] | null;
  active: string;
  onSelect: (name: string) => void;
  loading: boolean;
  online?: boolean;
}

export default function EngineSidebar({
  engines,
  relays = null,
  active,
  onSelect,
  loading,
  online = true,
}: EngineSidebarProps) {
  return (
    <aside className="space-y-2.5" aria-label="引擎列表" aria-busy={loading}>
      <div className="flex items-center justify-between px-1">
        <span className="text-(length:--text-xs) font-medium text-text-secondary">
          节点引擎（{engineNames.length}）
        </span>
      </div>

      <div className="space-y-2" role="tablist" aria-orientation="vertical">
        {engineNames.map((name) => {
          const engine = engines?.find((item) => item.name === name);
          const isSelected = active === name;
          const isRealm = name === 'realm';
          const serviceCount = engine?.service_count ?? 0;
          const isInstalled =
            engine && ['installed', 'running', 'stopped', 'degraded'].includes(engine.status);
          const isRunning =
            online && engine?.last_error !== 'engine_external' && engine?.status === 'running';
          const isOwnershipConflict = engine?.last_error === 'engine_external';
          const isDegraded = engine?.status === 'degraded';

          const engineRelays =
            engine && relays
              ? relays.filter((r) =>
                  isRealm
                    ? r.draft.engine_id === engine.id
                    : r.draft.landing_engine_id === engine.id,
                )
              : [];
          const attentionRelayCount = engineRelays.filter(isRelayAttention).length;
          const manualRealmCount =
            isRealm && relays && engine
              ? Math.max(0, serviceCount - engineRelays.filter((r) => !r.removed_at).length)
              : serviceCount;

          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelect(name)}
              onKeyDown={(e) => {
                const idx = engineNames.indexOf(name);
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  const next = engineNames[(idx + 1) % engineNames.length];
                  onSelect(next);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  const prev = engineNames[(idx - 1 + engineNames.length) % engineNames.length];
                  onSelect(prev);
                }
              }}
              className={`w-full rounded-(--radius-control) border-[1px] p-3 text-left transition-colors ${
                isSelected
                  ? 'border-accent bg-surface'
                  : 'border-border bg-surface-raised hover:bg-surface-muted'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      isOwnershipConflict
                        ? 'bg-warning'
                        : !isInstalled
                          ? 'bg-border-strong'
                          : isRunning
                            ? 'bg-success'
                            : isDegraded
                              ? 'bg-danger'
                              : 'bg-text-muted'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate text-(length:--text-sm) font-medium text-foreground">
                    {name}
                  </span>
                </div>
                <span className="shrink-0 text-(length:--text-xs) text-text-secondary">
                  {isRealm ? '中转入口' : '代理落地'}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 text-(length:--text-xs)">
                <span className="font-mono text-text-secondary tabular-nums">
                  {engine
                    ? engine.version ||
                      (engine.status === 'not_installed' ? '未安装' : '安装待确认')
                    : '未安装'}
                </span>
                <span
                  className={
                    isOwnershipConflict
                      ? 'font-medium text-warning'
                      : !isInstalled
                        ? 'text-text-muted'
                        : isRunning
                          ? 'font-medium text-success'
                          : isDegraded
                            ? 'font-medium text-danger'
                            : 'text-text-muted'
                  }
                >
                  {engine ? engineRuntimeStatus(engine, online) : ''}
                </span>
              </div>

              {isInstalled && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t-[1px] border-border-subtle pt-2">
                  {isRealm ? (
                    <>
                      <Badge size="sm" tone={attentionRelayCount > 0 ? 'warning' : 'neutral'}>
                        {engineRelays.length} 托管中转
                      </Badge>
                      {manualRealmCount > 0 && (
                        <Badge size="sm" tone="neutral">
                          {manualRealmCount} 手动规则
                        </Badge>
                      )}
                    </>
                  ) : (
                    <>
                      <Badge size="sm" tone="neutral">
                        {serviceCount} 服务
                      </Badge>
                      {engineRelays.length > 0 && (
                        <Badge size="sm" tone={attentionRelayCount > 0 ? 'warning' : 'info'}>
                          {engineRelays.length} 中转
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
