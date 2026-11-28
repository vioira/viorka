import { Copy, KeyRound, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  createRegistrationToken,
  getRegistrationTokenValue,
  type RegistrationSecret,
  type RegistrationToken,
} from '@/api/registration';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { InstallInstructions } from '@/components/registration/InstallInstructions';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function CreateRegistrationToken({
  session,
  onCreated,
  existing,
  disabled,
}: {
  session: Session;
  onCreated?: () => void;
  existing?: RegistrationToken;
  disabled?: boolean;
}) {
  const dialogFormId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [kind, setKind] = useState('vps');
  const [hours, setHours] = useState('24');
  const [maxUses, setMaxUses] = useState('50');
  const [result, setResult] = useState<RegistrationSecret | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [, error] = useToastFeedback('error');
  const [, success] = useToastFeedback('success');
  useEffect(() => {
    if (!open || !existing) return;
    void attempt;
    const controller = new AbortController();
    setPending(true);
    getRegistrationTokenValue(existing.id, controller.signal)
      .then((token) => {
        if (!controller.signal.aborted) setResult({ ...existing, token });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          error(cause instanceof Error ? cause.message : '无法读取令牌，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [open, existing, attempt, error]);
  useEffect(() => {
    if (!result) return;
    const timer = setInterval(() => {
      if (Date.parse(result.expires_at) <= Date.now()) {
        setResult(null);
        setOpen(false);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [result]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy.current) return;
        setOpen(value);
        if (!value) {
          setResult(null);
          setName('');
          setPrefix('');
          setKind('vps');
          setHours('24');
          setMaxUses('50');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          size={existing ? 'sm' : 'md'}
          variant={existing ? 'secondary' : 'primary'}
          disabled={disabled}
          aria-label={existing ? `查看 ${existing.name} 的安装命令` : undefined}
        >
          {existing ? (
            <KeyRound size={15} aria-hidden="true" />
          ) : (
            <Plus size={16} aria-hidden="true" />
          )}
          {existing ? '查看命令' : '创建令牌'}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={result || existing ? '批量注册令牌' : '创建批量注册令牌'}
        description={
          result || existing
            ? (result?.name ?? existing?.name)
            : '一个令牌可注册多台节点，注册次数和有效期由你设定。'
        }
        className="[--dialog-width:720px]"
        footer={
          result || existing ? (
            <DialogClose asChild>
              <Button variant="secondary">关闭</Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="secondary" disabled={pending} type="button">
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" loading={pending} disabled={pending} form={dialogFormId}>
                <Plus size={16} aria-hidden="true" />
                创建令牌
              </Button>
            </>
          )
        }
        onPointerDownOutside={(event) => {
          if (result) event.preventDefault();
        }}
      >
        {result ? (
          <div className="min-w-0 space-y-5">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label="注册令牌"
                  value={result.token}
                  readOnly
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </div>
              <Button
                variant="secondary"
                className="shrink-0"
                aria-label="复制注册令牌"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.token);
                    success('注册令牌已复制。');
                  } catch {
                    error('无法访问剪贴板，请选中令牌后手动复制。');
                  }
                }}
              >
                <Copy size={16} aria-hidden="true" />
              </Button>
            </div>
            <dl className="grid gap-4 text-(length:--text-sm) sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-text-secondary">已注册 / 上限</dt>
                <dd className="tabular-nums">
                  {result.used_count} / {result.max_uses}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-text-secondary">有效至</dt>
                <dd className="tabular-nums">
                  {new Date(result.expires_at).toLocaleString('zh-CN')}
                </dd>
              </div>
            </dl>
            <p className="text-(length:--text-sm) text-text-secondary">
              有效期内可从令牌列表再次查看，撤销后不可使用。
            </p>
            <InstallInstructions registration token={result.token} />
          </div>
        ) : existing ? (
          <div aria-busy={pending} className="space-y-4">
            <p className="text-text-secondary">{pending ? '正在读取令牌…' : '令牌尚未读取'}</p>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCw size={16} aria-hidden="true" />
              重新读取
            </Button>
          </div>
        ) : (
          <form
            id={dialogFormId}
            className="space-y-6"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy.current) return;
              if (
                !name.trim() ||
                new TextEncoder().encode(name.trim()).length > 128 ||
                new TextEncoder().encode(prefix).length > 32
              ) {
                error('令牌名称须为 1 到 128 字节，节点名称前缀最多 32 字节。');
                return;
              }
              busy.current = true;
              setPending(true);
              try {
                const created = await createRegistrationToken(session, {
                  name: name.trim(),
                  kind: kind as 'vps' | 'nat',
                  name_prefix: prefix,
                  expires_in_hours: Number(hours),
                  max_uses: Number(maxUses),
                });
                setResult(created);
                success('批量注册令牌已创建。');
                onCreated?.();
              } catch (cause) {
                error(
                  `${cause instanceof Error ? cause.message : '创建结果未确认。'} 若连接中断，请刷新列表查看创建结果。`,
                );
              } finally {
                busy.current = false;
                setPending(false);
              }
            }}
          >
            <fieldset disabled={pending} className="min-w-0 space-y-5">
              <Input
                label="令牌名称"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={128}
                placeholder="例如香港节点部署"
              />
              <Input
                label="节点名称前缀（可选）"
                description="未指定节点名称时，使用前缀加服务器主机名。"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
                maxLength={32}
              />
              <SegmentedControl
                label="节点类型"
                value={kind}
                onValueChange={setKind}
                options={[
                  { value: 'vps', label: '公网 VPS' },
                  { value: 'nat', label: 'NAT VPS' },
                ]}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="有效期（小时）"
                  type="number"
                  min={1}
                  max={720}
                  step={1}
                  required
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                />
                <Input
                  label="最多注册节点数"
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  required
                  value={maxUses}
                  onChange={(event) => setMaxUses(event.target.value)}
                />
              </div>
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
