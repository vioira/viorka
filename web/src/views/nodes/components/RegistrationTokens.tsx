import { Ban, RefreshCw, Server } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { nodeKind } from '@/api/nodes';
import {
  listRegistrationTokens,
  REGISTRATION_PAGE_SIZE,
  type RegistrationToken,
  registrationStatus,
  revokeRegistrationToken,
} from '@/api/registration';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import DataTable from '@/components/data-table';
import Pagination from '@/components/pagination';
import { cursorListPageSizes, useCursorList } from '@/hooks/use-cursor-list';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import CreateRegistrationToken from './CreateRegistrationToken';
import RegistrationRecords from './RegistrationRecords';

export default function RegistrationTokens({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const list = useCursorList({
    enabled: open,
    fetchItems: listRegistrationTokens,
    defaultPageSize: REGISTRATION_PAGE_SIZE,
    errorMessage: '无法读取批量令牌，请重试。',
  });
  const [revoking, setRevoking] = useState<RegistrationToken | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const revokeTrigger = useRef<HTMLButtonElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(0);
  const [, error] = useToastFeedback('error');
  const [, success] = useToastFeedback('success');
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy.current) return;
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Server size={16} aria-hidden="true" />
          批量注册
        </Button>
      </DialogTrigger>
      <DialogContent title="批量注册令牌" className="[--dialog-width:1000px]">
        <div className="space-y-6">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              loading={list.loading}
              ref={refreshButton}
              variant="secondary"
              disabled={list.loading}
              onClick={() => void list.refresh()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              刷新列表
            </Button>
            <CreateRegistrationToken session={session} onCreated={() => void list.refresh(true)} />
          </div>
          <DataTable
            minWidth={760}
            rows={list.items}
            rowKey="id"
            loaded={list.loaded}
            loading={list.loading}
            error={list.error}
            onRetry={list.retry}
            caption="批量注册令牌"
            emptyMessage="暂无批量注册令牌"
            columns={[
              {
                sortable: false,
                key: 'name',
                label: '名称',
                render: (value) => <span className="wrap-anywhere">{String(value)}</span>,
              },
              {
                sortable: false,
                key: 'kind',
                label: '类型',
                render: (value) => nodeKind(String(value)),
              },
              {
                sortable: false,
                key: 'used_count',
                label: '已注册 / 上限',
                render: (_, row) => (
                  <span className="tabular-nums">
                    {row.used_count} / {row.max_uses}
                  </span>
                ),
              },
              {
                sortable: false,
                key: 'expires_at',
                label: '有效至',
                render: (value) => new Date(String(value)).toLocaleString('zh-CN'),
              },
              {
                sortable: false,
                key: 'status',
                label: '状态',
                render: (_, row) => registrationStatus(row, now),
              },
              {
                sortable: false,
                key: 'actions',
                label: '操作',
                render: (_, row) => (
                  <div className="flex flex-wrap gap-2">
                    <CreateRegistrationToken
                      session={session}
                      existing={row}
                      disabled={!!row.revoked_at || Date.parse(row.expires_at) <= now}
                    />
                    <RegistrationRecords id={row.id} name={row.name} />
                    <Button
                      variant="danger"
                      aria-label="撤销令牌"
                      disabled={!!row.revoked_at || pending}
                      onClick={(event) => {
                        revokeTrigger.current = event.currentTarget;
                        setRevoking(row);
                      }}
                    >
                      <Ban size={16} aria-hidden="true" />
                      撤销
                    </Button>
                  </div>
                ),
              },
            ]}
          />
          {list.loaded && (
            <Pagination
              label="批量注册令牌分页"
              page={list.page}
              hasNext={list.hasNext}
              busy={list.loading}
              onPageChange={list.goToPage}
              pageSize={{
                value: list.pageSize,
                options: cursorListPageSizes,
                onChange: list.changePageSize,
              }}
            />
          )}
        </div>
        <Dialog
          open={!!revoking}
          onOpenChange={(value) => {
            if (!value && !busy.current) setRevoking(null);
          }}
        >
          <DialogContent
            title="撤销批量注册令牌"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (revokeTrigger.current && !revokeTrigger.current.disabled)
                revokeTrigger.current.focus();
              else refreshButton.current?.focus();
            }}
            description={`撤销“${revoking?.name ?? ''}”后，该令牌无法继续注册或重试。已注册节点继续运行。此操作不可撤销。`}
            footer={
              <>
                <Button variant="secondary" disabled={pending} onClick={() => setRevoking(null)}>
                  取消撤销
                </Button>
                <Button
                  variant="danger"
                  loading={pending}
                  disabled={pending}
                  onClick={async () => {
                    if (!revoking || busy.current) return;
                    busy.current = true;
                    setPending(true);
                    try {
                      await revokeRegistrationToken(session, revoking.id);
                      list.updateItems((items) =>
                        items.map((item) =>
                          item.id === revoking.id
                            ? { ...item, revoked_at: new Date().toISOString() }
                            : item,
                        ),
                      );
                      setRevoking(null);
                      success('批量注册令牌已撤销。');
                      void list.refresh();
                    } catch (cause) {
                      error(
                        cause instanceof Error ? cause.message : '撤销结果未确认，请刷新列表。',
                      );
                    } finally {
                      busy.current = false;
                      setPending(false);
                    }
                  }}
                >
                  <Ban size={16} aria-hidden="true" />
                  确认撤销令牌
                </Button>
              </>
            }
          />
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
