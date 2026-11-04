import { useEffect, useRef, useState } from 'react';
import type { EngineService } from '@/api/engines';
import { listProtocolPresets, type ProtocolPreset } from '@/api/protocol-presets';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export default function PresetPicker({
  onSelect,
}: {
  onSelect: (preset: Partial<EngineService>) => void;
}) {
  const { toast } = useToastStack();
  const [items, setItems] = useState<ProtocolPreset[] | null>(null);
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function load(after = '') {
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
          description: error instanceof Error ? error.message : '请重试读取。',
        });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  return (
    <section
      className="space-y-3 border-b-[0.5px] border-border pb-4"
      aria-label="从协议配置填入"
      aria-busy={loading}
    >
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        disabled={loading}
        onClick={() => load()}
      >
        读取协议预设
      </Button>
      {items?.length === 0 && <p className="text-text-secondary">尚未添加协议配置。</p>}
      {items && (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-all">
                {p.config.name}
                {!p.referenceable && '（暂不支持节点引用）'}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={!p.referenceable}
                onClick={() => {
                  const split = p.config.target.lastIndexOf(':');
                  onSelect({
                    preset_id: p.id,
                    name: p.config.name,
                    listen_port: p.config.port,
                    target_host: p.config.target.slice(0, split).replace(/^\[|\]$/g, ''),
                    target_port: Number(p.config.target.slice(split + 1)),
                    server_name: p.config.server_name,
                  });
                }}
              >
                填入配置
              </Button>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={loading}
          onClick={() => load(next)}
        >
          加载更多预设
        </Button>
      )}
      <p className="text-text-secondary">填入后可调整服务参数。保存草稿和应用配置仍需分别操作。</p>
    </section>
  );
}
