import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { listProtocolPresets, type ProtocolPreset, transportLabel } from '@/api/protocol-presets';
import { Button } from '@/components/arc/button/button';
import { SortableDataTable } from '@/components/arc/sortable-data-table/sortable-data-table';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export default function ProtocolPresetsPage() {
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const { toast } = useToastStack();
  const [items, setItems] = useState<ProtocolPreset[] | null>(null);
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
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
  const rows = (items ?? []).map((p) => ({
    id: p.id,
    name: p.config.name,
    protocol: 'VLESS',
    port: p.config.port,
    transport: transportLabel(p.config.transport),
    security: p.config.security.toUpperCase(),
    availability: p.referenceable ? '可用于节点草稿' : '暂不支持节点引用',
  }));
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-(length:--text-xl) font-medium">协议配置</h1>
          <p className="mt-2 text-text-secondary">保存常用的 VLESS 参数，供节点快速创建服务。</p>
        </div>
        <Button
          className="min-h-11"
          disabled={session.user.role === 'viewer'}
          onClick={() => navigate('/protocol-presets/new')}
        >
          新建协议配置
        </Button>
      </header>
      <section className="min-w-0 space-y-4" aria-label="协议配置列表" aria-busy={loading}>
        <div className="flex justify-end">
          <Button
            className="min-h-11"
            variant="secondary"
            disabled={loading}
            onClick={() => load()}
          >
            刷新列表
          </Button>
        </div>
        <div className="min-w-0 overflow-x-auto">
          <SortableDataTable
            rows={rows}
            rowKey="id"
            caption="已添加的协议配置"
            emptyMessage={
              items === null
                ? loading
                  ? '正在读取协议配置…'
                  : '协议配置尚未读取'
                : '尚未添加协议配置，请先新建一个 VLESS 预设。'
            }
            columns={[
              {
                key: 'name',
                label: '名称',
                render: (_, row) => <span className="break-all">{row.name}</span>,
              },
              { key: 'protocol', label: '协议' },
              { key: 'port', label: 'TCP 端口', numeric: true },
              { key: 'transport', label: '传输方式' },
              { key: 'security', label: '传输层安全' },
              { key: 'availability', label: '节点引用' },
            ]}
          />
        </div>
        {next && (
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={loading}
            onClick={() => load(next)}
          >
            加载更多配置
          </Button>
        )}
      </section>
    </>
  );
}
