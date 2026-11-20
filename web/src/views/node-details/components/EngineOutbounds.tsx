import { ArrowRight, ExternalLink, Plus, RefreshCw, Unlink } from 'lucide-react';
import { type RefObject, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { EngineRouting, Outbound, OutboundConfig } from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { SearchField } from '@/components/arc/search-field/search-field';
import DataTable from '@/components/data-table';
import EmptyStates from '@/components/empty-states';
import InitialSkeleton from '@/components/initial-skeleton';

const protocolNames: Record<OutboundConfig['type'], string> = {
  vless: 'VLESS',
  socks: 'SOCKS5',
  http: 'HTTP CONNECT',
};

function serverAddress(config: OutboundConfig) {
  const { server, server_port: port } = config;
  return `${server.includes(':') && !server.startsWith('[') ? `[${server}]` : server}:${port}`;
}

function OutboundConfigLink() {
  return (
    <Link
      className="inline-flex items-center gap-2 py-2 text-(length:--text-sm) font-medium text-foreground underline-offset-4 hover:underline"
      to="/proxy/outbounds"
      target="_blank"
      rel="noreferrer"
    >
      管理出口
      <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">（在新标签页打开）</span>
    </Link>
  );
}

function OutboundPicker({
  available,
  loading,
  hasCatalog,
  disabled,
  searchRef,
  onPick,
  onRefresh,
}: {
  available: Outbound[] | null;
  loading: boolean;
  hasCatalog: boolean;
  disabled: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onPick: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  const term = query.trim().toLowerCase();
  const matches = (available ?? []).filter(({ config }) =>
    `${config.name} ${protocolNames[config.type]} ${serverAddress(config)}`
      .toLowerCase()
      .includes(term),
  );
  function updateQuery(value: string) {
    setQuery(value);
    setLimit(12);
  }

  if (available === null) {
    return loading ? (
      <InitialSkeleton label="正在读取共享出口" lines={3} />
    ) : (
      <EmptyStates
        title="共享出口尚未读取"
        variant="unknown"
        headingLevel={3}
        action={
          <Button variant="secondary" onClick={onRefresh}>
            刷新出口列表
          </Button>
        }
      />
    );
  }
  if (available.length === 0) {
    return (
      <EmptyStates
        title={hasCatalog ? '已引用全部可用出口' : '尚无共享出口'}
        variant={hasCatalog ? 'empty' : 'unconfigured'}
        headingLevel={3}
        action={<OutboundConfigLink />}
      />
    );
  }

  return (
    <div className="min-w-0 space-y-3" aria-busy={loading}>
      <SearchField
        ref={searchRef}
        label="搜索出口"
        hideLabel
        placeholder="搜索名称、协议或服务器"
        value={query}
        onValueChange={updateQuery}
      />
      <p role="status" className="sr-only">
        {matches.length === 0 ? '没有匹配的出口' : ''}
      </p>
      {matches.length === 0 ? (
        <EmptyStates
          title="没有匹配的出口"
          variant="no-results"
          headingLevel={3}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                updateQuery('');
                searchRef.current?.focus();
              }}
            >
              清除搜索条件
            </Button>
          }
        />
      ) : (
        <ul aria-label="可引用出口" className="divide-y-[1px] divide-border">
          {matches.slice(0, limit).map(({ id, config }) => (
            <li key={id} className="flex min-w-0 items-center justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1 wrap-anywhere">
                <p className="text-(length:--text-sm) font-medium text-foreground">{config.name}</p>
                <p className="flex flex-wrap gap-x-2 gap-y-1 text-(length:--text-xs) text-text-secondary tabular-nums">
                  <span>{protocolNames[config.type]}</span>
                  <span className="min-w-0">{serverAddress(config)}</span>
                </p>
              </div>
              <Button
                variant="secondary"
                aria-label={`引用 ${config.name}`}
                disabled={disabled || loading}
                onClick={() => onPick(id)}
              >
                引用
              </Button>
            </li>
          ))}
        </ul>
      )}
      {matches.length > limit && (
        <Button variant="ghost" onClick={() => setLimit(limit + 12)}>
          显示更多出口
        </Button>
      )}
    </div>
  );
}

export default function EngineOutbounds({
  routing,
  catalog,
  catalogById,
  loading,
  disabled,
  onRefresh,
  onViewRouting,
  onChange,
}: {
  routing: EngineRouting;
  catalog: Outbound[] | null;
  catalogById: ReadonlyMap<string, Outbound>;
  loading: boolean;
  disabled: boolean;
  onRefresh: () => Promise<void>;
  onViewRouting: () => void;
  onChange: (routing: EngineRouting) => void;
}) {
  const [open, setOpen] = useState(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const atLimit = routing.outbound_ids.length >= 32;
  const available = catalog?.filter(({ id }) => !routing.outbound_ids.includes(id)) ?? null;
  const rows = routing.outbound_ids.map((id) => ({
    id,
    config: catalogById.get(id)?.config,
    defaultExit: routing.final === id,
    ruleCount: routing.rules.filter((rule) => rule.outbound === id).length,
  }));

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <OutboundConfigLink />
          <Button
            variant="ghost"
            aria-label="刷新出口列表"
            loading={loading}
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            刷新
          </Button>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button ref={addTrigger} variant="secondary" disabled={disabled || atLimit}>
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              引用出口
            </Button>
          </DialogTrigger>
          <DialogContent
            title="引用共享出口"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              if (searchRef.current) {
                event.preventDefault();
                searchRef.current.focus();
              }
            }}
          >
            {open && (
              <OutboundPicker
                available={available}
                hasCatalog={!!catalog?.length}
                loading={loading}
                disabled={disabled || atLimit}
                searchRef={searchRef}
                onPick={(id) => {
                  onChange({ ...routing, outbound_ids: [...routing.outbound_ids, id] });
                  setOpen(false);
                }}
                onRefresh={onRefresh}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
      <DataTable
        rows={rows}
        loaded
        loading={loading}
        rowKey="id"
        caption="已引用出口"
        emptyMessage="尚未引用出口"
        emptyState={{ variant: 'unconfigured' }}
        columns={[
          {
            key: 'name',
            label: '出口',
            sortable: false,
            render: (_, { config, id }) => (
              <div className="min-w-0 space-y-1 wrap-anywhere">
                <p className="font-medium">
                  {config?.name ?? (catalog ? '配置不可用' : '出口信息尚未读取')}
                </p>
                <p className="text-(length:--text-xs) text-text-secondary">
                  {config ? protocolNames[config.type] : id}
                </p>
              </div>
            ),
          },
          {
            key: 'server',
            label: '服务器',
            sortable: false,
            render: (_, { config }) =>
              config ? (
                <span className="wrap-anywhere tabular-nums">{serverAddress(config)}</span>
              ) : (
                '未读取'
              ),
          },
          {
            key: 'usage',
            label: '用途',
            sortable: false,
            render: (_, { defaultExit, ruleCount }) => (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary">
                {defaultExit && <span>默认出口</span>}
                {ruleCount > 0 && <span className="tabular-nums">{ruleCount} 条规则</span>}
                {!defaultExit && ruleCount === 0 && <span>未使用</span>}
              </div>
            ),
          },
          {
            key: 'actions',
            label: '操作',
            sortable: false,
            width: 156,
            render: (_, { id, config, defaultExit, ruleCount }) =>
              defaultExit || ruleCount > 0 ? (
                <Button variant="ghost" onClick={onViewRouting}>
                  查看分流
                  <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  aria-label={`移除 ${config?.name ?? id} 的引用`}
                  disabled={disabled}
                  onClick={() => {
                    onChange({
                      ...routing,
                      outbound_ids: routing.outbound_ids.filter((value) => value !== id),
                    });
                    requestAnimationFrame(() => addTrigger.current?.focus());
                  }}
                >
                  <Unlink size={16} strokeWidth={1.75} aria-hidden="true" />
                  移除引用
                </Button>
              ),
          },
        ]}
      />
      {rows.length > 0 && (
        <p className="pt-2 text-(length:--text-xs) text-text-secondary">出口连通性尚未验证</p>
      )}
    </div>
  );
}
