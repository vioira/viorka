import type { EngineRecord } from '@/api/engines';
import { engineNames, engineStatus } from '@/api/engines';

export interface EngineSidebarProps {
  engines: EngineRecord[] | null;
  active: string;
  onSelect: (name: string) => void;
  loading: boolean;
}

export default function EngineSidebar({ engines, active, onSelect, loading }: EngineSidebarProps) {
  return (
    <aside className="space-y-2" aria-label="引擎列表" aria-busy={loading}>
      <div className="flex items-center justify-between px-1">
        <span className="font-medium text-text-muted tracking-wider uppercase">
          安装引擎 ({engineNames.length})
        </span>
      </div>

      <div className="space-y-1.5" role="tablist" aria-orientation="vertical">
        {engineNames.map((name) => {
          const engine = engines?.find((item) => item.name === name);
          const isSelected = active === name;
          const serviceCount =
            engine?.draft?.services?.filter((s) => !s.pending_delete).length ?? 0;
          const isInstalled = engine && engine.status !== 'not_installed';
          const isRunning = engine?.status === 'running';
          const isDegraded = engine?.status === 'degraded';

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
              className={`w-full text-left p-3 rounded-(--radius-control) border-[1px] transition-colors relative outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isSelected
                  ? 'border-accent bg-surface shadow-xs'
                  : 'border-border bg-surface-raised hover:bg-surface-muted'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      !isInstalled
                        ? 'bg-border-strong'
                        : isRunning
                          ? 'bg-success'
                          : isDegraded
                            ? 'bg-danger'
                            : 'bg-text-muted'
                    }`}
                  />
                  <span className="font-medium text-(length:--text-sm) truncate">{name}</span>
                </div>
                <span className="text-(length:--text-xs) font-medium px-1.5 py-0.5 rounded bg-surface-muted border-[1px] border-border tabular-nums shrink-0">
                  {name === 'realm' ? `${serviceCount} 转发` : `${serviceCount} 服务`}
                </span>
              </div>

              <div className="flex items-center justify-between text-(length:--text-xs) text-text-secondary">
                <span className="tabular-nums font-mono">
                  {isInstalled ? engine.version || '版本未确认' : '未安装'}
                </span>
                <span
                  className={
                    !isInstalled
                      ? 'text-text-muted'
                      : isRunning
                        ? 'text-success font-medium'
                        : isDegraded
                          ? 'text-danger font-medium'
                          : 'text-text-muted'
                  }
                >
                  {isInstalled ? engineStatus(engine.status) : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
