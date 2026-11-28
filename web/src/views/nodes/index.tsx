import { CheckSquare, ListFilter, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import { Button } from '@/components/arc/button/button';
import EmptyStates from '@/components/empty-states';
import {
  BatchCategoryBar,
  ClassificationDrawer,
  NodeCategoryPopover,
  useCategoryCatalog,
} from '@/components/node-classification';
import NodeInventory from '@/components/node-inventory';
import { GenerateEnrollment } from '@/components/registration/RegistrationDialogs';
import { type ListedNode, useNodes } from '@/hooks/use-nodes';
import NodeFilterBar from './components/NodeFilterBar';
import NodeGroupedList from './components/NodeGroupedList';
import RegistrationTokens from './components/RegistrationTokens';
import {
  clearNodeFilters,
  countNodeFacets,
  hasActiveNodeFilters,
  matchesNodeFilters,
  mergeCatalogCategories,
  type NodeFilterState,
  parseNodeFilters,
  serializeNodeFilters,
  sortNodes,
} from './node-filters';

const QUICK_STATES = [
  { value: 'online', label: '在线', dotClass: 'bg-success' },
  { value: 'offline', label: '离线', dotClass: 'bg-danger' },
  { value: 'pending', label: '待注册', dotClass: 'bg-warning' },
  { value: 'disabled', label: '已禁用', dotClass: 'bg-text-muted' },
] as const;

export default function NodesPage() {
  const data = useNodes();
  const navigate = useNavigate();
  const session = useOutletContext<Session>();
  const admin = session.user.role === 'admin';
  const catalogState = useCategoryCatalog(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const filters = useMemo(() => parseNodeFilters(searchParams), [searchParams]);

  const updateFilters = useCallback(
    (next: NodeFilterState) => {
      setSearchParams(serializeNodeFilters(next), { replace: true, preventScrollReset: true });
    },
    [setSearchParams],
  );

  const categories = useMemo(
    () => mergeCatalogCategories(catalogState.catalog?.items ?? [], data.nodes),
    [catalogState.catalog, data.nodes],
  );

  const counts = useMemo(
    () => countNodeFacets(data.nodes, categories, now),
    [data.nodes, categories, now],
  );

  const filteredNodes = useMemo(
    () =>
      sortNodes(
        data.nodes.filter((node) => matchesNodeFilters(node, filters, now)),
        filters.sort,
        now,
      ),
    [data.nodes, filters, now],
  );

  const active = hasActiveNodeFilters(filters);
  const visibleSelectedNodes = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return filteredNodes.filter((node) => selectedSet.has(node.id));
  }, [filteredNodes, selectedIds]);
  const visibleSelectedIds = useMemo(
    () => visibleSelectedNodes.map((node) => node.id),
    [visibleSelectedNodes],
  );
  const batchActive = admin && (batchMode || visibleSelectedNodes.length > 0);

  const toggleGroupFilter = useCallback(
    (groupId: string) => {
      updateFilters({
        ...filters,
        group: filters.group === groupId ? 'all' : groupId,
      });
    },
    [filters, updateFilters],
  );

  const toggleTagFilter = useCallback(
    (tagId: string) => {
      const base = filters.tags.filter((id) => id !== 'none');
      const next = base.includes(tagId) ? base.filter((id) => id !== tagId) : [...base, tagId];
      updateFilters({ ...filters, tags: next });
    },
    [filters, updateFilters],
  );

  const refreshAll = useCallback(() => {
    void data.refresh();
    void catalogState.refresh(true);
  }, [data, catalogState]);

  const openNodeDetails = useCallback(
    (node: ListedNode) => {
      void navigate(`/nodes/${encodeURIComponent(node.id)}`, { state: { initialNode: node } });
    },
    [navigate],
  );

  const renderCategoryEditor = useMemo(() => {
    if (!admin) return undefined;
    return (node: ListedNode) => (
      <NodeCategoryPopover
        session={session}
        node={node}
        catalog={catalogState.catalog}
        onCatalogChange={catalogState.setCatalog}
        onChange={refreshAll}
      />
    );
  }, [admin, session, catalogState.catalog, catalogState.setCatalog, refreshAll]);

  const filtersDisabled = !data.loaded || data.nodes.length === 0;
  const allStatesSelected = filters.states.length === 0;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="节点状态快捷筛选"
          className="flex max-w-full items-center gap-1.5 overflow-x-auto py-0.5 text-(length:--text-xs)"
        >
          <button
            type="button"
            aria-pressed={allStatesSelected}
            disabled={!data.loaded}
            onClick={() => updateFilters({ ...filters, states: [] })}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border-[1px] px-2.5 py-1 tabular-nums disabled:opacity-50 ${
              allStatesSelected
                ? 'border-(--table-row-selected-border) bg-(--accent-subtle) font-medium text-foreground'
                : 'border-transparent text-text-secondary hover:bg-surface-muted hover:text-foreground'
            }`}
          >
            <span>全部 {data.loaded ? data.nodes.length : '-'}</span>
          </button>
          {data.loaded &&
            QUICK_STATES.map((item) => {
              const pressed = filters.states.length === 1 && filters.states[0] === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={pressed}
                  disabled={data.nodes.length === 0}
                  onClick={() =>
                    updateFilters({
                      ...filters,
                      states: pressed ? [] : [item.value],
                    })
                  }
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border-[1px] px-2.5 py-1 tabular-nums disabled:opacity-50 ${
                    pressed
                      ? 'border-(--table-row-selected-border) bg-(--accent-subtle) font-medium text-foreground'
                      : 'border-transparent text-text-secondary hover:bg-surface-muted hover:text-foreground'
                  }`}
                >
                  <span className={`size-1.5 rounded-full ${item.dotClass}`} aria-hidden="true" />
                  <span>
                    {item.label} {counts.states[item.value]}
                  </span>
                </button>
              );
            })}
        </div>

        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          {admin && (
            <Button
              variant="secondary"
              disabled={!data.loaded || filteredNodes.length === 0}
              aria-pressed={batchActive}
              onClick={() => {
                if (batchActive) {
                  setBatchMode(false);
                  setSelectedIds([]);
                } else {
                  setBatchMode(true);
                }
              }}
            >
              <CheckSquare size={16} aria-hidden="true" />
              {batchActive ? '退出批量' : '批量选择'}
            </Button>
          )}
          <Button
            loading={data.loading}
            variant="secondary"
            disabled={data.loading}
            onClick={refreshAll}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新节点
          </Button>
          {admin && (
            <ClassificationDrawer
              session={session}
              nodes={data.nodes}
              catalog={catalogState.catalog}
              onCatalogChange={catalogState.setCatalog}
              onChange={refreshAll}
              onFilterByCategory={(cat) => {
                if (cat.kind === 'group') {
                  updateFilters({ ...filters, group: cat.id });
                } else {
                  updateFilters({ ...filters, tags: [cat.id] });
                }
              }}
            />
          )}
          {admin && <RegistrationTokens session={session} />}
          <GenerateEnrollment
            session={session}
            disabled={!admin}
            triggerLabel="添加节点"
            onCreated={data.created}
            onViewNodes={() => updateFilters(clearNodeFilters(filters))}
          />
        </div>
      </div>

      <NodeFilterBar
        filters={filters}
        counts={counts}
        categories={categories}
        matchedCount={filteredNodes.length}
        totalCount={data.nodes.length}
        disabled={filtersDisabled}
        onChange={updateFilters}
      />

      {batchActive && (
        <BatchCategoryBar
          session={session}
          selectedNodes={visibleSelectedNodes}
          filteredCount={filteredNodes.length}
          catalog={catalogState.catalog}
          onCatalogChange={catalogState.setCatalog}
          onSelectAllFiltered={() =>
            setSelectedIds([...new Set([...selectedIds, ...filteredNodes.map((n) => n.id)])])
          }
          onClearSelection={() => setSelectedIds([])}
          onExitBatchMode={() => {
            setBatchMode(false);
            setSelectedIds([]);
          }}
          onChange={refreshAll}
        />
      )}

      {filters.view === 'grouped' && data.loaded && filteredNodes.length > 0 ? (
        <NodeGroupedList
          nodes={filteredNodes}
          categories={categories}
          loaded={data.loaded}
          loading={data.loading}
          selectable={admin}
          batchMode={batchActive}
          selectedKeys={visibleSelectedIds}
          onSelectionChange={setSelectedIds}
          onEnterBatchMode={() => setBatchMode(true)}
          onRowClick={openNodeDetails}
          onFilterByGroup={toggleGroupFilter}
          onFilterByTag={toggleTagFilter}
          renderCategoryEditor={renderCategoryEditor}
        />
      ) : filters.view === 'grouped' && data.loaded && filteredNodes.length === 0 ? (
        <section className="v-card">
          <EmptyStates
            headingLevel={3}
            compact
            variant={active ? 'no-results' : 'empty'}
            title={active ? '没有匹配的节点' : '暂无节点'}
            description={
              active
                ? undefined
                : admin
                  ? '添加节点后可查看资源与运行状态。'
                  : '请联系管理员添加节点。'
            }
            action={
              active ? (
                <Button
                  variant="secondary"
                  onClick={() => updateFilters(clearNodeFilters(filters))}
                >
                  <ListFilter size={16} aria-hidden="true" />
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        </section>
      ) : (
        <NodeInventory
          nodes={filteredNodes}
          loaded={data.loaded}
          loading={data.loading}
          selectable={admin}
          batchMode={batchActive}
          selectedKeys={visibleSelectedIds}
          onSelectionChange={setSelectedIds}
          onRowClick={openNodeDetails}
          onFilterByGroup={toggleGroupFilter}
          onFilterByTag={toggleTagFilter}
          renderCategoryEditor={renderCategoryEditor}
          emptyMessage={active ? '没有匹配的节点' : '暂无节点'}
          emptyState={{
            variant: active ? 'no-results' : 'empty',
            description: active
              ? undefined
              : admin
                ? '添加节点后可查看资源与运行状态。'
                : '请联系管理员添加节点。',
            action: active ? (
              <Button variant="secondary" onClick={() => updateFilters(clearNodeFilters(filters))}>
                <ListFilter size={16} aria-hidden="true" />
                清除筛选
              </Button>
            ) : undefined,
          }}
        />
      )}
    </div>
  );
}
