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
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import CreateRegistrationToken from './CreateRegistrationToken';
import RegistrationRecords from './RegistrationRecords';

export default function RegistrationTokens({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [after, setAfter] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [rows, setRows] = useState<RegistrationToken[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
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
  useEffect(() => {
    if (!open) return;
    void attempt;
    const controller = new AbortController();
    setLoading(true);
    listRegistrationTokens(after, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setRows(items);
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          error(cause instanceof Error ? cause.message : '无法读取批量令牌，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, after, attempt, error]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy.current) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">批量注册</Button>
      </DialogTrigger>
      <DialogContent
        title="批量注册"
        className="[--dialog-width:1000px]"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              disabled={loading || !after}
              onClick={() => {
                setAfter('');
              }}
            >
              返回首页
            </Button>
            <Button
              variant="secondary"
              disabled={loading || !loaded || rows.length < REGISTRATION_PAGE_SIZE}
              onClick={() => {
                setAfter(rows.at(-1)?.id ?? '');
              }}
            >
              下一页
            </Button>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              ref={refreshButton}
              variant="secondary"
              disabled={loading}
              onClick={() => setAttempt((value) => value + 1)}
            >
              刷新令牌
            </Button>
            <CreateRegistrationToken
              session={session}
              onCreated={() => {
                setAfter('');
                setAttempt((value) => value + 1);
              }}
            />
          </div>
          {rows.length > 0 && (
            <ul aria-label="批量注册令牌" className="divide-y divide-border-subtle sm:hidden">
              {rows.map((row) => (
                <li key={row.id} className="space-y-3 py-4 first:pt-0">
                  <p className="wrap-anywhere font-medium">{row.name}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-(length:--text-sm)">
                    <dt className="text-text-secondary">类型</dt>
                    <dd>{nodeKind(row.kind)}</dd>
                    <dt className="text-text-secondary">已注册 / 上限</dt>
                    <dd className="tabular-nums">
                      {row.used_count} / {row.max_uses}
                    </dd>
                    <dt className="text-text-secondary">有效至</dt>
                    <dd className="tabular-nums">
                      {new Date(row.expires_at).toLocaleString('zh-CN')}
                    </dd>
                    <dt className="text-text-secondary">状态</dt>
                    <dd>{registrationStatus(row, now)}</dd>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <RegistrationRecords id={row.id} name={row.name} />
                    <Button
                      variant="ghost"
                      disabled={!!row.revoked_at || pending}
                      onClick={(event) => {
                        revokeTrigger.current = event.currentTarget;
                        setRevoking(row);
                      }}
                    >
                      撤销令牌
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className={rows.length > 0 ? 'hidden sm:block' : undefined}>
            <DataTable
              tableClassName="min-w-[760px]"
              rows={rows}
              rowKey="id"
              loaded={loaded}
              loading={loading}
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
                      <RegistrationRecords id={row.id} name={row.name} />
                      <Button
                        variant="ghost"
                        disabled={!!row.revoked_at || pending}
                        onClick={(event) => {
                          revokeTrigger.current = event.currentTarget;
                          setRevoking(row);
                        }}
                      >
                        撤销令牌
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
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
                      setRows((items) =>
                        items.map((item) =>
                          item.id === revoking.id
                            ? { ...item, revoked_at: new Date().toISOString() }
                            : item,
                        ),
                      );
                      setRevoking(null);
                      success('批量注册令牌已撤销。');
                      setAttempt((value) => value + 1);
                    } catch (cause) {
                      error(
                        cause instanceof Error ? cause.message : '撤销结果未确认，请刷新令牌。',
                      );
                    } finally {
                      busy.current = false;
                      setPending(false);
                    }
                  }}
                >
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
