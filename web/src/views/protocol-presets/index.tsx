import { Eye, ListFilter, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { listProtocolPresets, type ProtocolPreset, transportLabel } from '@/api/protocol-presets';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable, { type DataColumn } from '@/components/data-table';
import PresetInspectorDrawer from './components/PresetInspectorDrawer';

type CompatibilityFilter = 'all' | 'referenceable' | 'archived';

type PresetRow = {
  id: string;
  preset: ProtocolPreset;
  name: string;
  subtitle: string;
  port: number;
  transport: string;
  security: string;
  fingerprint: string;
  extraMeta: string;
  supportedEngines: string[];
};

export default function ProtocolPresetsPage() {
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const { toast } = useToastStack();
  const canManage = session.user.role !== 'viewer';

  const [items, setItems] = useState<ProtocolPreset[] | null>(null);
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [compat, setCompat] = useState<CompatibilityFilter>('all');
  const [inspecting, setInspecting] = useState<ProtocolPreset | null>(null);

  const controller = useRef<AbortController | null>(null);
  const focusRef = useRef<HTMLElement | null>(null);

  const load = useCallback(
    async (after = '') => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setLoading(true);
      try {
        const result = await listProtocolPresets(after, abort.signal);
        if (abort.signal.aborted) return;
        setItems((previous) => (after ? [...(previous ?? []), ...result.items] : result.items));
        setNext(result.next_cursor);
      } catch (error) {
        if (!abort.signal.aborted)
          toast({
            id: 'presets-load',
            type: 'error',
            title: '未能读取协议配置',
            description: error instanceof Error ? error.message : '请刷新列表重试。',
          });
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  const allRows = useMemo<PresetRow[]>(
    () =>
      (items ?? []).map((preset) => {
        const c = preset.config;
        const subtitle =
          c.security === 'reality'
            ? c.site === 'external'
              ? `握手目标 ${c.target || '未填写'}`
              : '本节点站点'
            : c.cdn_host
              ? `CDN ${c.cdn_host}`
              : `SNI ${c.server_name || '跟随节点'}`;
        const supportedEngines = ['sing-box', 'xray'].filter(
          (engine) => preset.reference_issues?.[engine] === '',
        );
        return {
          id: preset.id,
          preset,
          name: c.name,
          subtitle,
          port: c.port,
          transport: transportLabel(c.transport),
          security: c.security.toUpperCase(),
          fingerprint: c.fingerprint,
          extraMeta:
            c.security === 'reality'
              ? `${c.short_ids.length} 组 Short ID`
              : c.certificate === 'self_signed'
                ? '自签名证书'
                : 'Let’s Encrypt',
          supportedEngines,
        };
      }),
    [items],
  );

  const search = query.trim().toLocaleLowerCase();
  const rows = useMemo(
    () =>
      allRows.filter((row) => {
        if (compat === 'referenceable' && !row.preset.referenceable) return false;
        if (compat === 'archived' && row.preset.referenceable) return false;
        if (
          search &&
          !`${row.name} ${row.port} ${row.subtitle} ${row.transport} ${row.security} ${row.fingerprint}`
            .toLocaleLowerCase()
            .includes(search)
        ) {
          return false;
        }
        return true;
      }),
    [allRows, compat, search],
  );

  const hasFilter = Boolean(query) || compat !== 'all';

  const columns: DataColumn<PresetRow>[] = [
    {
      key: 'name',
      label: '名称与目标',
      render: (_, row) => (
        <div className="max-w-64 space-y-1 wrap-anywhere">
          <p className="font-medium text-foreground">{row.name}</p>
          <p className="font-mono text-(length:--text-xs) text-text-secondary">{row.subtitle}</p>
        </div>
      ),
    },
    {
      key: 'transport',
      label: '传输与安全',
      render: (_, row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge size="sm" tone="neutral">
            VLESS
          </Badge>
          <Badge size="sm" tone="neutral">
            {row.transport}
          </Badge>
          <Badge size="sm" tone="neutral">
            {row.security}
          </Badge>
        </div>
      ),
    },
    {
      key: 'port',
      label: '默认端口',
      numeric: true,
      render: (_, row) => <span className="font-mono tabular-nums">{row.port}</span>,
    },
    {
      key: 'fingerprint',
      label: '混淆与证书',
      render: (_, row) => (
        <div className="space-y-1 text-(length:--text-xs) text-text-secondary">
          <p className="font-mono text-foreground">{row.fingerprint}</p>
          <p className="tabular-nums">{row.extraMeta}</p>
        </div>
      ),
    },
    {
      key: 'supportedEngines',
      label: '引擎引用兼容性',
      sortable: false,
      render: (_, row) =>
        row.supportedEngines.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {row.supportedEngines.map((engine) => (
              <Badge key={engine} size="sm" tone="success" dot>
                {engine}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-(length:--text-xs) text-text-secondary">
            仅预设存档（暂不可引用）
          </span>
        ),
    },
    {
      key: 'actions',
      label: '操作',
      sortable: false,
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={(event) => {
              focusRef.current = event.currentTarget;
              setInspecting(row.preset);
            }}
          >
            <Eye size={15} strokeWidth={1.75} aria-hidden="true" />
            查看
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canManage}
            onClick={() => navigate(`/proxy/protocol-presets/${encodeURIComponent(row.id)}/edit`)}
          >
            <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
            编辑
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <div className="min-w-52 flex-1 sm:max-w-72">
            <SearchField
              hideLabel
              label="搜索协议配置"
              placeholder="名称、端口、SNI 或传输方式"
              value={query}
              onValueChange={setQuery}
            />
          </div>
          <SegmentedControl
            label="按节点引用状态筛选"
            value={compat}
            onValueChange={(value) => setCompat(value as CompatibilityFilter)}
            options={[
              { value: 'all', label: '全部' },
              { value: 'referenceable', label: '可引用' },
              { value: 'archived', label: '仅存档' },
            ]}
          />
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button loading={loading} variant="secondary" disabled={loading} onClick={() => load()}>
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            刷新列表
          </Button>
          <Button disabled={!canManage} onClick={() => navigate('/proxy/protocol-presets/new')}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            新建协议配置
          </Button>
        </div>
      </div>

      <section className="v-card space-y-4" aria-label="协议配置列表">
        <DataTable
          loaded={items !== null}
          loading={loading}
          rows={rows}
          rowKey="id"
          caption="已添加的协议配置"
          emptyMessage={items?.length ? '没有匹配的协议配置' : '尚未添加协议配置'}
          unknownMessage="协议配置尚未读取"
          emptyState={{
            variant: hasFilter ? 'no-results' : 'empty',
            action: hasFilter ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery('');
                  setCompat('all');
                }}
              >
                <ListFilter size={16} strokeWidth={1.75} aria-hidden="true" />
                清除筛选
              </Button>
            ) : undefined,
          }}
          columns={columns}
        />
        {next && (
          <div className="flex justify-center pt-2">
            <Button variant="secondary" disabled={loading} onClick={() => load(next)}>
              加载更多配置
            </Button>
          </div>
        )}
      </section>

      <PresetInspectorDrawer
        preset={inspecting}
        canManage={canManage}
        onClose={() => setInspecting(null)}
        onEdit={(preset) => {
          setInspecting(null);
          void navigate(`/proxy/protocol-presets/${encodeURIComponent(preset.id)}/edit`);
        }}
        returnFocus={() => focusRef.current?.focus()}
      />
    </>
  );
}
