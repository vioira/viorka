import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { copyOutbound, deleteOutbound, listOutbounds, type Outbound } from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { Input } from '@/components/arc/input/input';
import { SortableDataTable } from '@/components/arc/sortable-data-table/sortable-data-table';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import OutboundEditor from './components/OutboundEditor';
export default function OutboundConfigsPage() {
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const [items, setItems] = useState<Outbound[] | null>(null);
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Outbound | null | undefined>(undefined);
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
      } catch (e) {
        if (!controller.signal.aborted)
          toast({
            id: 'outbounds-load',
            type: 'error',
            title: '未能读取出口配置',
            description: e instanceof Error ? e.message : '请刷新列表重试。',
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
    } catch (e) {
      toast({
        id: 'outbound-delete',
        type: 'error',
        title: '未能删除出口',
        description: e instanceof Error ? e.message : '请先移除节点引用并应用配置。',
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-(length:--text-xl) font-medium">出口配置</h1>
          <p className="mt-2 text-text-secondary">
            统一维护代理出口，节点只引用。出口连通性尚未验证。
          </p>
        </div>
        <Button
          className="min-h-11"
          disabled={session.user.role === 'viewer'}
          onClick={(e) => {
            focus.current = e.currentTarget;
            setEditing(null);
          }}
        >
          添加出口配置
        </Button>
      </header>
      <section className="min-w-0 space-y-4" aria-label="出口配置列表" aria-busy={loading}>
        <div className="flex justify-end">
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={loading}
            onClick={() => load()}
          >
            刷新列表
          </Button>
        </div>
        <div className="min-w-0 overflow-x-auto">
          <SortableDataTable
            rows={(items ?? []).map((item) => ({
              ...item,
              name: item.config.name,
              type: item.config.type,
              server: `${item.config.server}:${item.config.server_port}`,
            }))}
            rowKey="id"
            caption="共享出口配置"
            emptyMessage={
              items === null ? '出口配置尚未读取' : '尚未添加出口配置，可粘贴 VLESS 链接创建。'
            }
            columns={[
              {
                key: 'name',
                label: '名称',
                render: (_, r) => <span className="break-all">{r.config.name}</span>,
              },
              {
                key: 'type',
                label: '协议',
                render: (_, r) =>
                  r.config.type === 'socks'
                    ? 'SOCKS5'
                    : r.config.type === 'http'
                      ? 'HTTP CONNECT'
                      : r.config.tls
                        ? 'VLESS TCP + REALITY'
                        : 'VLESS TCP',
              },
              {
                key: 'server',
                label: '服务器',
                render: (_, r) => (
                  <span className="break-all tabular-nums">
                    {r.config.server}:{r.config.server_port}
                  </span>
                ),
              },
              { key: 'references', label: '引用节点', numeric: true },
              {
                key: 'actions',
                label: '操作',
                sortable: false,
                render: (_, r) => (
                  <div
                    onFocusCapture={(e) => {
                      focus.current = e.currentTarget.querySelector('button');
                    }}
                  >
                    <DropdownMenu
                      label="更多操作"
                      items={[
                        {
                          label: '编辑出口',
                          disabled: session.user.role === 'viewer',
                          onSelect: () => setEditing(r),
                        },
                        {
                          label: '复制出口',
                          disabled: session.user.role === 'viewer',
                          onSelect: () => {
                            setCopyName(`${r.config.name.slice(0, 110)} 副本`);
                            setCopying(r);
                          },
                        },
                        {
                          label: '删除出口',
                          destructive: true,
                          disabled: session.user.role === 'viewer' || r.references > 0,
                          onSelect: () => setDeleting(r),
                        },
                      ]}
                    />
                  </div>
                ),
              },
            ]}
          />
        </div>
        {next && (
          <Button variant="secondary" disabled={loading} onClick={() => load(next)}>
            加载更多出口
          </Button>
        )}
      </section>
      {editing !== undefined && (
        <OutboundEditor
          outbound={editing}
          returnFocus={() => focus.current?.focus()}
          session={session}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      )}
      <Dialog
        open={copying !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setCopying(null);
        }}
      >
        <DialogContent
          title="复制出口配置"
          description="创建独立的全局出口，现有节点引用保持不变。"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            focus.current?.focus();
          }}
        >
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
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
              onChange={(e) => setCopyName(e.target.value)}
            />
            <Button disabled={busy}>保存出口副本</Button>
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
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            focus.current?.focus();
          }}
        >
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>
              取消删除
            </Button>
            <Button disabled={busy} onClick={remove}>
              删除出口
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
