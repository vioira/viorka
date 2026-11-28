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
import { Badge, type BadgeTone } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import EmptyStates from '@/components/empty-states';
import InitialSkeleton from '@/components/initial-skeleton';
import Pagination from '@/components/pagination';
import { cursorListPageSizes, useCursorList } from '@/hooks/use-cursor-list';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import CreateRegistrationToken from './CreateRegistrationToken';
import RegistrationRecords from './RegistrationRecords';

function tokenStatusTone(row: RegistrationToken, now: number): BadgeTone {
  if (row.revoked_at) return 'neutral';
  if (Date.parse(row.expires_at) <= now || row.used_count >= row.max_uses) return 'warning';
  return 'success';
}

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
      <DialogContent title="批量注册令牌" className="[--dialog-width:min(760px,calc(100vw-2rem))]">
        <div className="space-y-4">
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

          {!list.loaded && list.loading ? (
            <InitialSkeleton lines={4} label="正在读取批量注册令牌" />
          ) : !list.loaded ? (
            <EmptyStates
              headingLevel={3}
              compact
              variant="unknown"
              title="批量注册令牌尚未读取"
              action={
                list.error ? (
                  <Button variant="secondary" onClick={list.retry}>
                    <RefreshCw size={15} aria-hidden="true" />
                    重新读取
                  </Button>
                ) : undefined
              }
            />
          ) : list.items.length === 0 ? (
            <EmptyStates headingLevel={3} compact variant="empty" title="暂无批量注册令牌" />
          ) : (
            <ul aria-label="批量注册令牌" className="space-y-3">
              {list.items.map((row) => {
                const status = registrationStatus(row, now);
                const disabledCommand = !!row.revoked_at || Date.parse(row.expires_at) <= now;
                return (
                  <li
                    key={row.id}
                    className="space-y-2.5 rounded-(--radius-control) border-[1px] border-border bg-background p-3.5 text-(length:--text-xs)"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="wrap-anywhere text-(length:--text-sm) font-medium text-foreground">
                          {row.name}
                        </span>
                        <Badge size="sm" tone="neutral">
                          {nodeKind(row.kind)}
                        </Badge>
                      </div>
                      <Badge size="sm" tone={tokenStatusTone(row, now)}>
                        {status}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-text-secondary tabular-nums">
                      <span>
                        已注册 {row.used_count} / {row.max_uses}
                      </span>
                      <span>有效至 {new Date(row.expires_at).toLocaleString('zh-CN')}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t-[1px] border-border-subtle pt-2.5">
                      <CreateRegistrationToken
                        session={session}
                        existing={row}
                        disabled={disabledCommand}
                      />
                      <RegistrationRecords id={row.id} name={row.name} />
                      <Button
                        size="sm"
                        variant="danger"
                        className="ml-auto"
                        aria-label={`撤销令牌 ${row.name}`}
                        disabled={!!row.revoked_at || pending}
                        onClick={(event) => {
                          revokeTrigger.current = event.currentTarget;
                          setRevoking(row);
                        }}
                      >
                        <Ban size={15} aria-hidden="true" />
                        撤销
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

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
