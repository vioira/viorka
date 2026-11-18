import { ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { listProtocolPresets, type ProtocolPreset, transportLabel } from '@/api/protocol-presets';
import { Button } from '@/components/arc/button/button';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { Tooltip } from '@/components/arc/tooltip/tooltip';

export function presetIssue(preset: ProtocolPreset, engine: string) {
  return preset.reference_issues?.[engine] ?? '尚未确认当前引擎兼容性，请刷新协议配置';
}

export default function PresetPicker({
  engine,
  value,
  onSelect,
  onResolve,
}: {
  engine: string;
  value: string;
  onSelect: (preset: ProtocolPreset) => void;
  onResolve: (preset: ProtocolPreset | null) => void;
}) {
  const { toast } = useToastStack();
  const [items, setItems] = useState<ProtocolPreset[] | null>(null);
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const autoPages = useRef(new Set<string>());
  const load = useCallback(
    async (after = '') => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setLoading(true);
      try {
        const result = await listProtocolPresets(after, controller.signal);
        if (controller.signal.aborted) return;
        setItems((previous) => (after ? [...(previous ?? []), ...result.items] : result.items));
        setNext(result.next_cursor);
      } catch (error) {
        if (!controller.signal.aborted)
          toast({
            id: 'preset-picker',
            type: 'error',
            title: '未能读取协议配置',
            description: error instanceof Error ? error.message : '请刷新协议配置后重试。',
          });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [toast],
  );
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);
  const selected = items?.find((preset) => preset.id === value) ?? null;
  useEffect(() => {
    onResolve(selected);
  }, [selected, onResolve]);
  // Resolve an existing reference even when it is on a later page.
  useEffect(() => {
    if (value && items && !selected && next && !loading && !autoPages.current.has(next)) {
      autoPages.current.add(next);
      void load(next);
    }
  }, [value, items, selected, next, loading, load]);
  const status = selected
    ? presetIssue(selected, engine)
    : value && items?.length !== 0
      ? '引用配置尚未读取，请加载更多或刷新。'
      : '';
  return (
    <section className="min-w-0 space-y-2" aria-label="选择协议配置" aria-busy={loading}>
      <span aria-hidden="true" className="block text-(length:--text-sm) font-medium">
        协议配置
      </span>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Select
            label="协议配置"
            hideLabel
            value={selected ? value : ''}
            placeholder={
              items === null
                ? loading
                  ? '正在读取协议配置…'
                  : '协议配置尚未读取'
                : items.length === 0
                  ? '尚无协议配置'
                  : '请选择协议配置'
            }
            disabled={items === null || items.length === 0}
            options={(items ?? []).map((preset) => {
              const reason = presetIssue(preset, engine);
              return {
                value: preset.id,
                label: `${preset.config.name} / ${transportLabel(preset.config.transport)}${reason ? `（${reason}）` : ''}`,
                disabled: Boolean(reason),
              };
            })}
            onValueChange={(id) => {
              const preset = items?.find((item) => item.id === id);
              if (preset && !presetIssue(preset, engine)) onSelect(preset);
            }}
            description={
              selected
                ? `VLESS / ${transportLabel(selected.config.transport)} / ${selected.config.security.toUpperCase()} / 端口 ${selected.config.port}`
                : undefined
            }
          />
        </div>
        <Tooltip content="刷新配置">
          <Button
            type="button"
            variant="ghost"
            className="shrink-0"
            aria-label="刷新配置"
            loading={loading}
            onClick={() => {
              if (loading) return;
              autoPages.current.clear();
              return load();
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
      {items?.length === 0 && (
        <Link
          to="/proxy/protocol-presets/new"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 py-2 text-(length:--text-sm) font-medium text-foreground underline-offset-4 hover:underline"
        >
          新建协议配置
          <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">（在新标签页打开）</span>
        </Link>
      )}
      {(status || next) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {status && (
            <p className="min-w-0 text-(length:--text-xs) text-text-secondary" role="status">
              {status}
            </p>
          )}
          {next && (
            <Button type="button" variant="ghost" disabled={loading} onClick={() => load(next)}>
              加载更多配置
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
