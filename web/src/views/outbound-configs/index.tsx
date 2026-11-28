import { Copy, Eye, ListFilter, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { copyOutbound, deleteOutbound, listOutbounds, type Outbound } from '@/api/outbounds';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { Input } from '@/components/arc/input/input';
import { SearchField } from '@/components/arc/search-field/search-field';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { CardGridSkeleton, EndpointCopyButton, shouldHandleCardClick } from '@/components/card-kit';
import EmptyStates from '@/components/empty-states';
import OutboundInspectorDrawer, {
  outboundCredentialStatus,
  outboundProtocolLabel,
} from './components/OutboundInspectorDrawer';

type ProtocolFilter = 'all' | Outbound['config']['type'];

type OutboundRow = {
  id: string;
  outbound: Outbound;
  name: string;
  type: Outbound['config']['type'];
  protocol: string;
  server: string;
  credentials: string;
  references: number;
};

export default function OutboundConfigsPage() {
  const dialogFormId = useId();
  const navigate = useNavigate();
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const canManage = session.user.role !== 'viewer';

  const [items, setItems] = useState<Outbound[] | null>(null);
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [protocolFilter, setProtocolFilter] = useState<ProtocolFilter>('all');

  const [inspecting, setInspecting] = useState<Outbound | null>(null);
  const [deleting, setDeleting] = useState<Outbound | null>(null);
  const [copying, setCopying] = useState<Outbound | null>(null);
  const [copyName, setCopyName] = useState('');
  const [busy, setBusy] = useState(false);

  const abort = useRef<AbortController | null>(null);
  const focus = useRef<HTMLElement | null>(null);

  const load = useCallback(
    async (after = '') => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setLoading(true);
      try {
        const result = await listOutbounds(after, controller.signal);
        if (controller.signal.aborted) return;
        setItems((old) => (after ? [...(old ?? []), ...result.items] : result.items));
        setNext(result.next_cursor);
      } catch (error) {
        if (!controller.signal.aborted)
          toast({
            id: 'outbounds-load',
            type: 'error',
            title: '未能读取出口配置',
            description: error instanceof Error ? error.message : '请刷新列表重试。',
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

  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await deleteOutbound(deleting, session);
      setDeleting(null);
      toast({ type: 'success', title: '出口已删除' });
      await load();
    } catch (error) {
      toast({
        id: 'outbound-delete',
        type: 'error',
        title: '未能删除出口',
        description: error instanceof Error ? error.message : '请先移除节点引用并应用配置。',
      });
    } finally {
      setBusy(false);
    }
  }

  function openEdit(item: Outbound) {
    void navigate(`/proxy/outbounds/${encodeURIComponent(item.id)}/edit`, {
      state: { initialOutbound: item },
    });
  }

  function openInspector(item: Outbound) {
    focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInspecting(item);
  }

  const allRows = useMemo<OutboundRow[]>(
    () =>
      (items ?? []).map((item) => ({
        id: item.id,
        outbound: item,
        name: item.config.name,
        type: item.config.type,
        protocol: outboundProtocolLabel(item.config),
        server: `${item.config.server}:${item.config.server_port}`,
        credentials: outboundCredentialStatus(item),
        references: item.references,
      })),
    [items],
  );

  const search = query.trim().toLocaleLowerCase();
  const rows = useMemo(
    () =>
      allRows.filter((row) => {
        if (protocolFilter !== 'all' && row.type !== protocolFilter) return false;
        if (
          search &&
          !`${row.name} ${row.server} ${row.protocol}`.toLocaleLowerCase().includes(search)
        ) {
          return false;
        }
        return true;
      }),
    [allRows, protocolFilter, search],
  );

  const hasFilter = Boolean(query) || protocolFilter !== 'all';

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <div className="min-w-44 flex-1 sm:max-w-72">
            <SearchField
              hideLabel
              label="搜索出口配置"
              placeholder="名称或服务器地址"
              value={query}
              onValueChange={setQuery}
            />
          </div>
          <div className="w-36">
            <Select
              hideLabel
              label="按协议筛选"
              value={protocolFilter}
              onValueChange={(value) => setProtocolFilter(value as ProtocolFilter)}
              options={[
                { value: 'all', label: '全部协议' },
                { value: 'vless', label: 'VLESS' },
                { value: 'socks', label: 'SOCKS5' },
                { value: 'http', label: 'HTTP' },
                { value: 'shadowsocks', label: 'Shadowsocks' },
              ]}
            />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button loading={loading} variant="secondary" disabled={loading} onClick={() => load()}>
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            刷新列表
          </Button>
          <Button disabled={!canManage} onClick={() => navigate('/proxy/outbounds/new')}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            新建出口配置
          </Button>
        </div>
      </div>

      <section aria-label="出口配置列表" className="min-w-0 space-y-4">
        {items === null && loading ? (
          <CardGridSkeleton count={6} cols="3col" label="正在读取出口配置" />
        ) : items === null ? (
          <div className="v-card">
            <EmptyStates headingLevel={3} compact variant="unknown" title="出口配置尚未读取" />
          </div>
        ) : rows.length === 0 ? (
          <div className="v-card">
            <EmptyStates
              headingLevel={3}
              compact
              variant={hasFilter ? 'no-results' : 'empty'}
              title={items.length ? '没有匹配的出口配置' : '尚未添加出口配置'}
              description={hasFilter ? undefined : '可手动填写或导入 SS、VLESS 链接。'}
              action={
                hasFilter ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery('');
                      setProtocolFilter('all');
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
                data-card="outbound"
                onClick={(event) => {
                  if (shouldHandleCardClick(event)) openInspector(row.outbound);
                }}
                className="flex min-w-0 cursor-pointer flex-col justify-between space-y-3 rounded-(--radius-surface) border-[1px] border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted/30"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      data-card-interactive="1"
                      onClick={() => openInspector(row.outbound)}
                      className="text-left text-(length:--text-sm) font-medium text-foreground hover:text-accent hover:underline wrap-anywhere"
                    >
                      {row.name}
                    </button>
                    <Badge size="sm" tone="neutral" className="shrink-0">
                      {row.protocol}
                    </Badge>
                  </div>

                  {row.type === 'http' && (
                    <p className="text-(length:--text-xs) text-(--status-warning-text)">
                      仅限显式 TCP 规则，不可作默认出口
                    </p>
                  )}

                  <div className="space-y-1.5 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/50 p-3 text-(length:--text-xs)">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono font-medium text-foreground tabular-nums">
                        {row.server}
                      </span>
                      <EndpointCopyButton
                        value={row.server}
                        label="出口服务器地址"
                        ariaLabel={`复制 ${row.name} 的目标服务器地址`}
                      />
                    </div>
                    <p className="text-text-secondary">{row.credentials}</p>
                  </div>

                  <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
                    {row.references > 0
                      ? `${row.references} 个节点正在引用（移除引用后可删除）`
                      : '尚未被节点引用'}
                  </p>
                </div>

                <div
                  className="flex items-center justify-between gap-2 border-t-[1px] border-border-subtle pt-2.5"
                  onFocusCapture={(event) => {
                    const button =
                      event.target instanceof HTMLElement ? event.target.closest('button') : null;
                    if (button) focus.current = button;
                  }}
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    data-card-interactive="1"
                    disabled={!canManage}
                    onClick={() => openEdit(row.outbound)}
                  >
                    <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                    编辑
                  </Button>
                  <div className="flex items-center gap-1" data-card-interactive="1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(event) => {
                        focus.current = event.currentTarget;
                        setInspecting(row.outbound);
                      }}
                    >
                      <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
                      详情
                    </Button>
                    <DropdownMenu
                      label="更多操作"
                      items={[
                        {
                          label: '复制出口',
                          icon: <Copy size={16} strokeWidth={1.75} aria-hidden="true" />,
                          disabled: !canManage,
                          onSelect: () => {
                            setCopyName(`${row.name.slice(0, 110)} 副本`);
                            setCopying(row.outbound);
                          },
                        },
                        {
                          label: row.references > 0 ? '移除节点引用后可删除' : '删除出口',
                          icon: <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />,
                          destructive: true,
                          separatorBefore: true,
                          disabled: !canManage || row.references > 0,
                          onSelect: () => setDeleting(row.outbound),
                        },
                      ]}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {next && (
          <div className="flex justify-center pt-2">
            <Button variant="secondary" disabled={loading} onClick={() => load(next)}>
              加载更多出口
            </Button>
          </div>
        )}
      </section>

      <OutboundInspectorDrawer
        outbound={inspecting}
        canManage={canManage}
        onClose={() => setInspecting(null)}
        onEdit={(item) => {
          setInspecting(null);
          openEdit(item);
        }}
        returnFocus={() => focus.current?.focus()}
      />

      <Dialog
        open={copying !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setCopying(null);
        }}
      >
        <DialogContent
          title="复制出口配置"
          description="创建独立的全局出口副本，不导出原始凭证，现有节点引用保持不变。"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focus.current?.focus();
          }}
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setCopying(null)}
              >
                取消
              </Button>
              <Button disabled={busy} loading={busy} type="submit" form={dialogFormId}>
                <Save size={16} strokeWidth={1.75} aria-hidden="true" />
                保存出口副本
              </Button>
            </>
          }
        >
          <form
            id={dialogFormId}
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!copying || busy) return;
              setBusy(true);
              try {
                await copyOutbound(copying, copyName, session);
                setCopying(null);
                toast({ type: 'success', title: '出口已复制' });
                await load();
              } catch (error) {
                toast({
                  id: 'outbound-copy',
                  type: 'error',
                  title: '未能复制出口',
                  description: error instanceof Error ? error.message : '请检查名称后重试。',
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Input
              label="新出口名称"
              value={copyName}
              maxLength={128}
              onChange={(event) => setCopyName(event.target.value)}
            />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent
          title="删除出口配置"
          description={`删除 ${deleting?.config.name ?? ''}。存在已发布或执行中的引用时，服务端会阻止删除。`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focus.current?.focus();
          }}
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                取消删除
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                loading={busy}
                onClick={remove}
              >
                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                确认删除出口
              </Button>
            </>
          }
        />
      </Dialog>
    </>
  );
}
