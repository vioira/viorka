import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  getNode,
  listAllNodes,
  type NodeRecord,
  nodeKind,
  nodeRegion,
  nodeState,
} from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

function StatusDot({ state }: { state?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 shrink-0 rounded-full ${
        state === 'online' ? 'bg-success' : state === 'pending' ? 'bg-warning' : 'bg-text-muted'
      }`}
    />
  );
}

export default function NodeSwitcher({
  node,
  missing,
}: {
  node: NodeRecord | null;
  missing: boolean;
}) {
  const [request, setRequest] = useState({ open: false, revision: 0 });
  const setOpen = (open: boolean) => setRequest((previous) => ({ ...previous, open }));
  const [nodes, setNodes] = useState<NodeRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToastStack();
  const navigate = useNavigate();
  const { search } = useLocation();
  const switching = useRef<AbortController | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => () => switching.current?.abort(), []);

  const switchNode = async (id: string) => {
    switching.current?.abort();
    const controller = new AbortController();
    switching.current = controller;
    setSwitchingId(id);
    try {
      const nextNode = await getNode(id, controller.signal);
      if (controller.signal.aborted) return;
      await navigate(`/nodes/${encodeURIComponent(id)}${search}`, {
        state: { initialNode: nextNode },
        preventScrollReset: true,
      });
      setOpen(false);
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: 'node-switcher',
          type: 'error',
          title: '未能切换节点',
          description: error instanceof Error ? error.message : '请重试。',
        });
    } finally {
      if (switching.current === controller) {
        switching.current = null;
        setSwitchingId(null);
      }
    }
  };

  useEffect(() => {
    if (!request.open) return;
    const controller = new AbortController();
    setLoading(true);
    listAllNodes(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setNodes(items);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        toast({
          id: 'node-switcher',
          type: 'error',
          title: '未能读取节点列表',
          description: error instanceof Error ? error.message : '请重新读取节点列表。',
          action: {
            label: '重试',
            onClick: () =>
              setRequest((previous) => ({ ...previous, revision: previous.revision + 1 })),
          },
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request, toast]);

  const name = node?.name || node?.id || (missing ? '节点不可用' : '正在读取节点');
  const region = nodeRegion(node?.location);

  return (
    <div className="min-w-0 max-w-full sm:max-w-96">
      <Popover open={request.open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className="min-h-11 max-w-full"
            style={{ minHeight: 44 }}
            aria-label={`切换节点，当前${name}，${node ? nodeState(node.state) : '状态未知'}，${region}`}
          >
            <span className="flex w-40 min-w-0 items-center gap-2 sm:w-72">
              <StatusDot state={node?.state} />
              <span className="min-w-0 truncate font-medium" title={name}>
                {name}
              </span>
              <span
                className="hidden min-w-0 truncate text-text-secondary sm:inline"
                title={region}
              >
                {region}
              </span>
              <ChevronDown size={16} className="ml-auto shrink-0" aria-hidden="true" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="切换节点"
          className="w-80"
          style={{ padding: 8, borderRadius: 'calc(var(--radius-control) + 8px)' }}
        >
          <div className="max-h-80 overflow-y-auto" aria-busy={loading}>
            {nodes === null || nodes.length === 0 ? (
              <p role="status" className="px-3 py-2 text-(length:--text-sm) text-text-secondary">
                {loading
                  ? '正在读取节点…'
                  : nodes === null
                    ? '节点列表尚未读取'
                    : '暂无可切换的节点'}
              </p>
            ) : (
              <ul className="space-y-1" aria-label="节点列表">
                {nodes.map((item) => {
                  const current = item.id === node?.id;
                  const displayed = current ? node : item;
                  return (
                    <li key={item.id}>
                      <Button
                        variant="ghost"
                        className="min-h-11 w-full rounded-(--radius-control)"
                        style={{
                          minHeight: 64,
                          padding: '8px 12px',
                          ...(current ? { background: 'var(--accent-subtle)' } : {}),
                        }}
                        loading={switchingId === item.id}
                        disabled={switchingId !== null}
                        aria-current={current ? 'page' : undefined}
                        aria-label={`${displayed.name || displayed.id}，${nodeState(displayed.state)}，${nodeKind(displayed.kind)}${current ? '，当前节点' : ''}`}
                        onClick={() => {
                          if (current) setOpen(false);
                          else void switchNode(item.id);
                        }}
                      >
                        <span className="flex w-64 min-w-0 items-center gap-3 text-left">
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span
                              className="truncate font-medium text-foreground"
                              title={displayed.name || displayed.id}
                            >
                              {displayed.name || displayed.id}
                            </span>
                            <span
                              className="truncate text-(length:--text-xs) text-text-secondary"
                              title={`${nodeKind(displayed.kind)}，${nodeRegion(displayed.location)}`}
                            >
                              {nodeKind(displayed.kind)}
                              <span className="ml-2">{nodeRegion(displayed.location)}</span>
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-(length:--text-xs) text-text-secondary">
                            <StatusDot state={displayed.state} />
                            {nodeState(displayed.state)}
                          </span>
                          <span className="flex size-4 shrink-0 items-center text-accent">
                            {current && <Check size={16} aria-hidden="true" />}
                          </span>
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
