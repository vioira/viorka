import { Check, Copy, ExternalLink, EyeOff, Globe, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import { listAllNodes, type NodeRecord } from '@/api/nodes';
import {
  type Publication,
  previewStatus,
  publishStatus,
  readPublication,
  type StatusPage,
} from '@/api/public-status';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent } from '@/components/arc/dialog/dialog';
import { useCopyFeedback } from '@/components/arc/lib/use-copy-feedback';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EmptyStates from '@/components/empty-states';
import InitialSkeleton from '@/components/initial-skeleton';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import StatusOverview from '@/views/public-status/components/StatusOverview';
import { stamp } from '@/views/public-status/format';
import StatusNodePicker from './StatusNodePicker';
import StatusPublishedList from './StatusPublishedList';
import {
  countInvalidDraftNodes,
  type DraftNode,
  fromPublicationNodes,
  isPublicationDirty,
  MAX_PUBLISHED_NODES,
  moveDraftNode,
  sortDraftNodesByAlias,
  sortDraftNodesOnlineFirst,
  toPublicationNodes,
} from './status-publication';

type ViewMode = 'edit' | 'preview';
type PendingAction = 'publish' | 'save-draft' | 'disable' | null;

const subscribeNoop = () => () => {};

export default function StatusSettings() {
  const session = useOutletContext<Session>();
  const admin = session.user.role === 'admin';
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [saved, setSaved] = useState<Publication | null>(null);
  const [draftNodes, setDraftNodes] = useState<DraftNode[]>([]);
  const [loading, setLoading] = useState(admin);
  const [loadError, setLoadError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [previewState, setPreviewState] = useState<{
    signature: string;
    page: StatusPage;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [confirmReloadOpen, setConfirmReloadOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const busyRef = useRef(false);

  const { toast } = useToastStack();
  const [, error] = useToastFeedback('error', 'status-publication');
  const [, success] = useToastFeedback('success');
  const copyFeedback = useCopyFeedback();

  const publicUrl = useSyncExternalStore(
    subscribeNoop,
    () => new URL('/status', window.location.origin).href,
    () => '/status',
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick triggers a fresh load and cancels any prior request.
  useEffect(() => {
    if (!admin) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    Promise.all([readPublication(controller.signal), listAllNodes(controller.signal)])
      .then(([publication, nodeList]) => {
        if (controller.signal.aborted) return;
        setSaved(publication);
        setDraftNodes(fromPublicationNodes(publication.nodes));
        setNodes(nodeList);
        setPreviewState(null);
        setPreviewError('');
        setLoadError('');
        error('');
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        const message = cause instanceof Error ? cause.message : '无法读取公开状态页配置，请重试。';
        setLoadError(message);
        error(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [admin, reloadTick, error]);

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedIds = useMemo(() => new Set(draftNodes.map((node) => node.id)), [draftNodes]);
  const savedIds = useMemo(() => new Set((saved?.nodes ?? []).map((node) => node.id)), [saved]);
  const onlineNodes = useMemo(() => nodes.filter((node) => node.state === 'online'), [nodes]);

  const dirty = useMemo(
    () => (saved ? isPublicationDirty(saved, draftNodes) : false),
    [saved, draftNodes],
  );
  const invalidCount = useMemo(() => countInvalidDraftNodes(draftNodes), [draftNodes]);
  const hasErrors = invalidCount > 0;
  const draftSignature = useMemo(() => JSON.stringify(draftNodes), [draftNodes]);
  const busy = pendingAction !== null || loading;

  const triggerReload = useCallback(() => {
    setConfirmReloadOpen(false);
    setReloadTick((tick) => tick + 1);
  }, []);

  const loadPreview = useCallback(
    async (targetNodes: DraftNode[], signature: string) => {
      if (!saved || targetNodes.length === 0 || countInvalidDraftNodes(targetNodes) > 0) return;
      setPreviewLoading(true);
      setPreviewError('');
      try {
        const page = await previewStatus(
          {
            revision: saved.revision,
            enabled: true,
            nodes: toPublicationNodes(targetNodes),
          },
          session.csrf_token,
        );
        setPreviewState({ signature, page });
        error('');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '无法生成访客预览，请重试。';
        setPreviewError(message);
        error(message);
      } finally {
        setPreviewLoading(false);
      }
    },
    [saved, session.csrf_token, error],
  );

  async function handleModeChange(nextMode: string) {
    if (nextMode !== 'edit' && nextMode !== 'preview') return;
    if (nextMode === 'preview' && draftNodes.length > 0 && hasErrors) {
      error('请先修正公开别名错误后再预览。');
      return;
    }
    setViewMode(nextMode);
    if (
      nextMode === 'preview' &&
      draftNodes.length > 0 &&
      (!previewState || previewState.signature !== draftSignature)
    ) {
      await loadPreview(draftNodes, draftSignature);
    }
  }

  async function persist(
    payload: Publication,
    nextDraftNodes: DraftNode[],
    action: Exclude<PendingAction, null>,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setPendingAction(action);
    error('');
    try {
      await publishStatus(payload, session.csrf_token);
      const nextSaved: Publication = {
        ...payload,
        revision: payload.revision + 1,
      };
      setSaved(nextSaved);
      setDraftNodes(nextDraftNodes);
      if (action === 'publish') {
        success(saved?.enabled ? '公开状态页更改已发布。' : '公开状态页已发布。');
      } else if (action === 'save-draft') {
        success('状态页草稿已保存。');
      } else {
        success('公开状态页已关闭。');
        setConfirmDisableOpen(false);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        toast({
          id: 'status-publication',
          type: 'error',
          title: '发布配置已被其他会话修改',
          description: '您的本地编排已保留。请读取最新配置后再重新保存。',
          action: {
            label: '读取最新配置',
            onClick: triggerReload,
          },
        });
      } else {
        error(cause instanceof Error ? cause.message : '操作失败，请重试。');
      }
    } finally {
      busyRef.current = false;
      setPendingAction(null);
    }
  }

  async function handleCopyLink() {
    const ok = await copyFeedback.copy(publicUrl);
    if (ok) success('公开链接已复制。');
    else error('复制公开链接失败，请手动复制地址。');
  }

  function addNodesToDraft(candidates: NodeRecord[]) {
    const remaining = MAX_PUBLISHED_NODES - draftNodes.length;
    if (remaining <= 0) {
      error(`公开状态页最多展示 ${MAX_PUBLISHED_NODES} 台节点。`);
      return;
    }
    const additions: DraftNode[] = [];
    for (const node of candidates) {
      if (selectedIds.has(node.id)) continue;
      if (additions.length >= remaining) break;
      additions.push({ id: node.id, alias: node.name });
    }
    if (additions.length === 0) return;
    const skipped =
      candidates.filter((node) => !selectedIds.has(node.id)).length - additions.length;
    setDraftNodes((current) => [...current, ...additions]);
    if (skipped > 0) {
      toast({
        id: 'status-node-limit',
        type: 'info',
        title: `已添加 ${additions.length} 台节点`,
        description: `受 ${MAX_PUBLISHED_NODES} 台数量上限限制，另有 ${skipped} 台节点未加入。`,
      });
    }
  }

  function toggleNodeInDraft(node: NodeRecord, checked: boolean) {
    if (checked) {
      addNodesToDraft([node]);
    } else {
      setDraftNodes((current) => current.filter((item) => item.id !== node.id));
    }
  }

  function updateDraftNode(id: string, patch: Partial<Pick<DraftNode, 'alias'>>) {
    setDraftNodes((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function resetAllAliases() {
    setDraftNodes((current) =>
      current.map((item) => {
        const original = nodeMap.get(item.id)?.name;
        return original ? { ...item, alias: original } : item;
      }),
    );
  }

  if (!admin) {
    return (
      <section className="v-card" aria-label="公开状态页">
        <EmptyStates
          variant="forbidden"
          title="需要管理员权限"
          description={`当前账号 ${session.user.username} 无法管理公开状态页。`}
        />
      </section>
    );
  }

  if (!saved && loading) {
    return (
      <section className="v-card" aria-busy="true" aria-label="公开状态页">
        <InitialSkeleton label="正在读取公开状态页配置" lines={4} />
      </section>
    );
  }

  if (!saved) {
    return (
      <section className="v-card" aria-label="公开状态页">
        <EmptyStates
          variant="unknown"
          title="发布配置尚未读取"
          description={loadError || '无法读取公开状态页配置，请重试。'}
          action={
            <Button variant="secondary" onClick={triggerReload}>
              <RefreshCw size={16} aria-hidden="true" />
              重新读取配置
            </Button>
          }
        />
      </section>
    );
  }

  const activePreview =
    previewState && previewState.signature === draftSignature ? previewState.page : null;
  const canPublish =
    !busy &&
    draftNodes.length > 0 &&
    draftNodes.length <= MAX_PUBLISHED_NODES &&
    !hasErrors &&
    (!saved.enabled || dirty);

  const statusBarHint = hasErrors
    ? `请先修正 ${invalidCount} 项输入错误后再继续`
    : draftNodes.length === 0 && !saved.enabled
      ? '至少选择 1 台节点后即可发布公开状态页'
      : draftNodes.length === 0 && saved.enabled
        ? '列表为空时无法发布更新；若需下线请点击上方“关闭公开页”'
        : dirty
          ? `当前有未发布更改，共配置 ${draftNodes.length} 台节点`
          : saved.enabled
            ? `已同步至公开状态页（${saved.nodes.length} 台节点）`
            : `已选 ${draftNodes.length} 台节点，当前尚未对外开放`;

  return (
    <div className="min-w-0 space-y-4">
      <section className="v-card space-y-4" aria-labelledby="public-status-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id="public-status-heading" className="v-card-title">
                公开状态页
              </h2>
              <Badge tone={saved.enabled ? 'success' : 'neutral'} dot>
                {saved.enabled ? '公开访问中' : '未开放'}
              </Badge>
              {dirty && <Badge tone="warning">有未发布更改</Badge>}
            </div>

            <p className="text-(length:--text-sm) text-text-secondary">
              {saved.enabled ? (
                <>
                  当前对外展示{' '}
                  <span className="font-medium text-foreground tabular-nums">
                    {saved.nodes.length}
                  </span>{' '}
                  台节点（版本 <span className="font-mono tabular-nums">r{saved.revision}</span>
                  ），任何持有链接的访客均可查看在线状态、资源与历史趋势。
                </>
              ) : (
                <>
                  状态页当前未开放，访客访问将提示未开放（版本{' '}
                  <span className="font-mono tabular-nums">r{saved.revision}</span>
                  ）。选定节点并发布后即可对外访问。
                </>
              )}
            </p>

            {saved.enabled && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-(--radius-control) border-[1px] border-border bg-surface-raised px-3 py-1.5 font-mono text-(length:--text-xs) text-foreground">
                  <Globe size={14} className="shrink-0 text-success" aria-hidden="true" />
                  <span className="truncate" title={publicUrl}>
                    {publicUrl}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleCopyLink()}
                >
                  {copyFeedback.state === 'copied' ? (
                    <Check size={15} aria-hidden="true" />
                  ) : (
                    <Copy size={15} aria-hidden="true" />
                  )}
                  <span>{copyFeedback.state === 'copied' ? '已复制' : '复制链接'}</span>
                </Button>
                <a
                  href="/status"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-(--control-height-md) items-center gap-1.5 rounded-(--radius-control) border-[1px] border-border bg-surface-raised px-3 text-(length:--text-sm) font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
                >
                  <ExternalLink size={15} aria-hidden="true" />
                  <span>打开状态页</span>
                </a>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="工作区视图"
              value={viewMode}
              onValueChange={(value) => void handleModeChange(value)}
              options={[
                { value: 'edit', label: '配置编排' },
                { value: 'preview', label: '访客预览' },
              ]}
            />
            <Button
              type="button"
              variant="secondary"
              loading={loading}
              disabled={busy}
              onClick={() => {
                if (dirty) setConfirmReloadOpen(true);
                else triggerReload();
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
              <span>重新读取</span>
            </Button>
            {saved.enabled && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmDisableOpen(true)}
              >
                <EyeOff size={16} aria-hidden="true" />
                <span>关闭公开页</span>
              </Button>
            )}
          </div>
        </div>
      </section>

      {viewMode === 'edit' ? (
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[23rem_minmax(0,1fr)]">
          <StatusNodePicker
            nodes={nodes}
            selectedIds={selectedIds}
            disabled={busy}
            onToggleNode={toggleNodeInDraft}
            onAddNodes={addNodesToDraft}
          />
          <StatusPublishedList
            entries={draftNodes}
            nodeMap={nodeMap}
            savedIds={savedIds}
            onlineCount={onlineNodes.length}
            disabled={busy}
            onUpdateNode={updateDraftNode}
            onMoveNode={(fromIndex, toIndex) =>
              setDraftNodes((current) => moveDraftNode(current, fromIndex, toIndex))
            }
            onRemoveNode={(id) =>
              setDraftNodes((current) => current.filter((item) => item.id !== id))
            }
            onAddAllOnline={() => addNodesToDraft(onlineNodes)}
            onSortByAlias={() => setDraftNodes((current) => sortDraftNodesByAlias(current))}
            onSortOnlineFirst={() =>
              setDraftNodes((current) => sortDraftNodesOnlineFirst(current, nodeMap))
            }
            onResetAliases={resetAllAliases}
            onClearAll={() => setDraftNodes([])}
          />
        </div>
      ) : (
        <section className="space-y-4" aria-label="访客预览">
          <div className="v-card flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-(length:--text-base) font-medium text-foreground">
                访客视角预览
              </h3>
              <Badge tone={dirty || !saved.enabled ? 'warning' : 'success'}>
                {dirty || !saved.enabled ? '当前草稿效果' : '与已发布页面一致'}
              </Badge>
              {activePreview && (
                <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                  快照时间 {stamp(activePreview.at)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={previewLoading}
                disabled={busy || previewLoading || draftNodes.length === 0 || hasErrors}
                onClick={() => void loadPreview(draftNodes, draftSignature)}
              >
                <RefreshCw size={15} aria-hidden="true" />
                <span>刷新预览</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setViewMode('edit')}
              >
                返回编辑
              </Button>
            </div>
          </div>

          {draftNodes.length === 0 ? (
            <div className="v-card">
              <EmptyStates
                headingLevel={3}
                compact
                variant="empty"
                title="尚未选择公开节点"
                description="请先在配置编排中添加至少 1 台节点，再查看访客状态页效果。"
                action={
                  <Button type="button" variant="secondary" onClick={() => setViewMode('edit')}>
                    返回选择节点
                  </Button>
                }
              />
            </div>
          ) : previewLoading && !activePreview ? (
            <div className="v-card" aria-busy="true">
              <InitialSkeleton label="正在生成访客预览" lines={5} />
            </div>
          ) : !activePreview ? (
            <div className="v-card">
              <EmptyStates
                headingLevel={3}
                compact
                variant="unknown"
                title="预览尚未生成"
                description={previewError || '无法生成访客预览，请刷新重试。'}
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={hasErrors}
                    onClick={() => void loadPreview(draftNodes, draftSignature)}
                  >
                    重试预览
                  </Button>
                }
              />
            </div>
          ) : (
            <StatusOverview preview page={activePreview} now={Date.parse(activePreview.at)} />
          )}
        </section>
      )}

      <footer
        className={`sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-surface) border-[1px] bg-surface-raised px-4 py-3.5 sm:px-5 ${
          dirty ? 'border-border-strong' : 'border-border'
        }`}
      >
        <p
          className={`text-(length:--text-xs) tabular-nums ${
            hasErrors ? 'font-medium text-danger' : 'text-text-secondary'
          }`}
          role="status"
          aria-live="polite"
        >
          {statusBarHint}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraftNodes(fromPublicationNodes(saved.nodes));
                setPreviewState(null);
              }}
            >
              放弃更改
            </Button>
          )}
          {!saved.enabled && dirty && (
            <Button
              type="button"
              variant="secondary"
              loading={pendingAction === 'save-draft'}
              disabled={busy || hasErrors}
              onClick={() =>
                void persist(
                  {
                    revision: saved.revision,
                    enabled: false,
                    nodes: toPublicationNodes(draftNodes),
                  },
                  draftNodes,
                  'save-draft',
                )
              }
            >
              仅保存草稿
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            loading={pendingAction === 'publish'}
            disabled={!canPublish}
            onClick={() =>
              void persist(
                {
                  revision: saved.revision,
                  enabled: true,
                  nodes: toPublicationNodes(draftNodes),
                },
                draftNodes,
                'publish',
              )
            }
          >
            {saved.enabled ? '发布更改' : '发布状态页'}
          </Button>
        </div>
      </footer>

      <Dialog
        open={confirmDisableOpen}
        onOpenChange={(open) => {
          if (pendingAction !== 'disable') setConfirmDisableOpen(open);
        }}
      >
        <DialogContent
          title="关闭公开状态页？"
          description={`关闭后，/status 与公开节点历史接口将立即停止对外访问。当前已配置的 ${saved.nodes.length} 台节点与别名会保留，后续可直接重新发布。`}
          footer={
            <>
              <DialogClose asChild>
                <Button type="button" variant="secondary" disabled={pendingAction === 'disable'}>
                  取消
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="danger"
                loading={pendingAction === 'disable'}
                disabled={busy}
                onClick={() =>
                  void persist(
                    {
                      revision: saved.revision,
                      enabled: false,
                      nodes: saved.nodes,
                    },
                    draftNodes,
                    'disable',
                  )
                }
              >
                关闭公开页
              </Button>
            </>
          }
        />
      </Dialog>

      <Dialog open={confirmReloadOpen} onOpenChange={setConfirmReloadOpen}>
        <DialogContent
          title="重新读取服务器配置？"
          description="当前存在尚未发布的本地修改，重新读取将放弃这些草稿更改并加载服务器最新配置。"
          footer={
            <>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  保留草稿
                </Button>
              </DialogClose>
              <Button type="button" variant="danger" onClick={triggerReload}>
                重新读取
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
