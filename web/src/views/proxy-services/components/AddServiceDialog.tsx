import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type EngineSummary, engineNames, engineStatus, listEngines } from '@/api/engines';
import type { ServiceNode } from '@/api/proxy-services';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { SearchField } from '@/components/arc/search-field/search-field';
import NodeStatus from '@/components/node-status';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function AddServiceDialog({
  open,
  nodes,
  onClose,
  onContinue,
  returnFocus,
}: {
  open: boolean;
  nodes: ServiceNode[];
  onClose: () => void;
  onContinue: (nodeId: string, engine: string) => void;
  returnFocus: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedEngine, setSelectedEngine] = useState<string>('sing-box');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const firstOnline = nodes.find((node) => node.state === 'online') ?? nodes[0];
    setSelectedNodeId((previous) =>
      nodes.some((node) => node.id === previous) ? previous : (firstOnline?.id ?? ''),
    );
  }, [open, nodes]);

  const search = query.trim().toLocaleLowerCase();
  const visibleNodes = nodes.filter(
    (node) => !search || `${node.name} ${node.id}`.toLocaleLowerCase().includes(search),
  );
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const [engineList, setEngineList] = useState<{ nodeId: string; items: EngineSummary[] } | null>(
    null,
  );
  const [, report] = useToastFeedback('error');
  const targetNode = open ? selectedNode?.id : undefined;
  useEffect(() => {
    setEngineList(null);
    if (!targetNode) return;
    const controller = new AbortController();
    listEngines(targetNode, controller.signal)
      .then(({ items }) => {
        if (!controller.signal.aborted) setEngineList({ nodeId: targetNode, items });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          report(error instanceof Error ? error.message : '引擎读取失败，请重新选择节点');
      });
    return () => controller.abort();
  }, [targetNode, report]);
  const enginesForSelected = engineList?.nodeId === selectedNodeId ? engineList.items : undefined;
  const targetEngineRecord = enginesForSelected?.find(
    (item) => item.name === selectedEngine && item.ownership === 'managed',
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        title="选择目标节点与引擎"
        description="服务配置在所属节点的引擎草稿中创建与发布。"
        className="[--dialog-width:560px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!selectedNodeId || !enginesForSelected}
              onClick={() => onContinue(selectedNodeId, selectedEngine)}
            >
              前往节点配置
              <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-2.5">
            <p className="text-(length:--text-xs) font-medium text-text-secondary">目标节点</p>
            {nodes.length > 5 && (
              <SearchField
                hideLabel
                label="搜索节点"
                placeholder="按节点名称筛选"
                value={query}
                onValueChange={setQuery}
              />
            )}
            {visibleNodes.length === 0 ? (
              <p className="rounded-(--radius-control) border-[1px] border-border bg-background px-4 py-6 text-center text-(length:--text-xs) text-text-secondary">
                {nodes.length === 0 ? '暂无可用节点，请先在节点页注册节点。' : '没有匹配的节点'}
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-label="选择目标节点"
                className="max-h-56 divide-y-[1px] divide-border-subtle overflow-y-auto rounded-(--radius-control) border-[1px] border-border"
              >
                {visibleNodes.map((node) => {
                  const active = node.id === selectedNodeId;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors ${
                        active ? 'bg-surface-muted' : 'bg-surface hover:bg-background'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-(length:--text-sm) font-medium text-foreground">
                          {node.name}
                        </p>
                      </div>
                      <div className="shrink-0 pt-0.5 text-(length:--text-xs)">
                        <NodeStatus state={node.state} showLastSeen={false} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            <p className="text-(length:--text-xs) font-medium text-text-secondary">目标引擎</p>
            <div role="radiogroup" aria-label="选择目标引擎" className="grid grid-cols-3 gap-2.5">
              {engineNames.map((name) => {
                const record = enginesForSelected?.find(
                  (item) => item.name === name && item.ownership === 'managed',
                );
                const installed = Boolean(record && record.status !== 'not_installed');
                const active = selectedEngine === name;
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelectedEngine(name)}
                    className={`rounded-(--radius-control) border-[1px] px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-accent bg-surface-muted'
                        : 'border-border bg-surface hover:bg-background'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-(length:--text-sm) font-medium text-foreground">{name}</p>
                      <span className="text-(length:--text-xs) text-text-muted">
                        {name === 'realm' ? '中转转发' : '代理落地'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-(length:--text-xs) text-text-secondary tabular-nums">
                      {!enginesForSelected
                        ? '尚未读取'
                        : installed
                          ? record?.version
                            ? `${engineStatus(record.status)} ${record.version}`
                            : engineStatus(record?.status ?? '')
                          : '尚未安装'}
                    </p>
                  </button>
                );
              })}
            </div>
            {selectedNode && enginesForSelected && (
              <p className="text-(length:--text-xs) text-text-secondary">
                {targetEngineRecord && targetEngineRecord.status !== 'not_installed'
                  ? `将打开 ${selectedNode.name} 的 ${selectedEngine} 新建服务表单。`
                  : `${selectedNode.name} 尚未安装 ${selectedEngine}，前往节点页面后需先安装引擎。`}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
