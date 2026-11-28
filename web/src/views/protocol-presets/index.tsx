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
import { CardGridSkeleton, shouldHandleCardClick } from '@/components/card-kit';
import EmptyStates from '@/components/empty-states';
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
                : 'Let’s Encrypt 证书',
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

  function openPresetInspector(preset: ProtocolPreset) {
    focusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInspecting(preset);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <div className="min-w-44 flex-1 sm:max-w-72">
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

      <section aria-label="协议配置列表" className="min-w-0 space-y-4">
        {items === null && loading ? (
          <CardGridSkeleton count={6} cols="3col" label="正在读取协议配置" />
        ) : items === null ? (
          <div className="v-card">
            <EmptyStates headingLevel={3} compact variant="unknown" title="协议配置尚未读取" />
          </div>
        ) : rows.length === 0 ? (
          <div className="v-card">
            <EmptyStates
              headingLevel={3}
              compact
              variant={hasFilter ? 'no-results' : 'empty'}
              title={items.length ? '没有匹配的协议配置' : '尚未添加协议配置'}
              action={
                hasFilter ? (
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
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <article
                key={row.id}
                data-card="preset"
                onClick={(event) => {
                  if (shouldHandleCardClick(event)) openPresetInspector(row.preset);
                }}
                className="flex min-w-0 cursor-pointer flex-col justify-between space-y-3 rounded-(--radius-surface) border-[1px] border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted/30"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      data-card-interactive="1"
                      onClick={() => openPresetInspector(row.preset)}
                      className="text-left text-(length:--text-sm) font-medium text-foreground hover:text-accent hover:underline wrap-anywhere"
                    >
                      {row.name}
                    </button>
                    <span className="shrink-0 font-mono text-(length:--text-xs) text-text-secondary tabular-nums">
                      端口 :{row.port}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge size="sm" tone="neutral">
                      VLESS
                    </Badge>
                    <Badge size="sm" tone="neutral">
                      {row.transport}
                    </Badge>
                    <Badge size="sm" tone="info">
                      {row.security}
                    </Badge>
                  </div>

                  <div className="space-y-1.5 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/50 p-3 text-(length:--text-xs)">
                    <p className="font-mono text-foreground wrap-anywhere">{row.subtitle}</p>
                    <p className="text-text-secondary tabular-nums">
                      指纹 {row.fingerprint}，{row.extraMeta}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-(length:--text-xs)">
                    <span className="text-text-secondary">引擎兼容：</span>
                    {row.supportedEngines.length > 0 ? (
                      row.supportedEngines.map((engine) => (
                        <Badge key={engine} size="sm" tone="success" dot>
                          {engine}
                        </Badge>
                      ))
                    ) : (
                      <Badge size="sm" tone="neutral">
                        仅预设存档（暂不可引用）
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 border-t-[1px] border-border-subtle pt-2.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    data-card-interactive="1"
                    disabled={!canManage}
                    onClick={() =>
                      navigate(`/proxy/protocol-presets/${encodeURIComponent(row.id)}/edit`)
                    }
                  >
                    <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-card-interactive="1"
                    onClick={(event) => {
                      focusRef.current = event.currentTarget;
                      setInspecting(row.preset);
                    }}
                  >
                    <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
                    详情
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}

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
