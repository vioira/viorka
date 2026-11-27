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
import DataTable, { type DataColumn } from '@/components/data-table';
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

  const columns: DataColumn<OutboundRow>[] = [
    {
      key: 'name',
      label: '出口名称',
      render: (_, row) => (
        <div className="max-w-60 space-y-1 wrap-anywhere">
          <p className="font-medium text-foreground">{row.name}</p>
          {row.type === 'http' && (
            <p className="text-(length:--text-xs) text-text-secondary">
              仅限显式 TCP 规则，不可作默认出口
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'protocol',
      label: '协议与安全',
      render: (_, row) => (
        <Badge size="sm" tone="neutral">
          {row.protocol}
        </Badge>
      ),
    },
    {
      key: 'server',
      label: '目标服务器',
      render: (_, row) => (
        <span className="font-mono text-(length:--text-xs) tabular-nums wrap-anywhere">
          {row.server}
        </span>
      ),
    },
    {
      key: 'credentials',
      label: '凭证状态',
      sortable: false,
      render: (_, row) => (
        <span className="text-(length:--text-xs) text-text-secondary">{row.credentials}</span>
      ),
    },
    {
      key: 'references',
      label: '引用节点',
      numeric: true,
      render: (_, row) => <span className="tabular-nums">{row.references} 个节点</span>,
    },
    {
      key: 'actions',
      label: '操作',
      sortable: false,
      render: (_, row) => (
        <div
          className="flex items-center gap-2"
          onFocusCapture={(event) => {
            const button =
              event.target instanceof HTMLElement ? event.target.closest('button') : null;
            if (button) focus.current = button;
          }}
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={(event) => {
              focus.current = event.currentTarget;
              setInspecting(row.outbound);
            }}
          >
            <Eye size={15} strokeWidth={1.75} aria-hidden="true" />
            查看
          </Button>
          <DropdownMenu
            label="更多操作"
            items={[
              {
                label: '编辑出口',
                icon: <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />,
                disabled: !canManage,
                onSelect: () => openEdit(row.outbound),
              },
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
                label: '删除出口',
                icon: <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />,
                destructive: true,
                disabled: !canManage || row.references > 0,
                onSelect: () => setDeleting(row.outbound),
              },
            ]}
          />
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
              label="搜索出口配置"
              placeholder="名称或服务器地址"
              value={query}
              onValueChange={setQuery}
            />
          </div>
          <Select
            hideLabel
            label="按协议筛选"
            value={protocolFilter}
            onValueChange={(value) => setProtocolFilter(value as ProtocolFilter)}
            options={[
              { value: 'all', label: '全部' },
              { value: 'vless', label: 'VLESS' },
              { value: 'socks', label: 'SOCKS5' },
              { value: 'http', label: 'HTTP' },
              { value: 'shadowsocks', label: 'Shadowsocks' },
            ]}
          />
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

      <section className="v-card space-y-4" aria-label="出口配置列表">
        <DataTable
          loaded={items !== null}
          loading={loading}
          rows={rows}
          rowKey="id"
          caption="共享出口配置"
          emptyMessage={items?.length ? '没有匹配的出口配置' : '尚未添加出口配置'}
          unknownMessage="出口配置尚未读取"
          emptyState={{
            variant: hasFilter ? 'no-results' : 'empty',
            description: hasFilter ? undefined : '可手动填写或导入 SS、VLESS 链接。',
            action: hasFilter ? (
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
            ) : undefined,
          }}
          columns={columns}
        />
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
