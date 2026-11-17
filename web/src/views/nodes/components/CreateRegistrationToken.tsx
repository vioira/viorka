import { useEffect, useId, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { createRegistrationToken, type RegistrationSecret } from '@/api/registration';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { InstallInstructions } from '@/components/registration/InstallInstructions';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function CreateRegistrationToken({
  session,
  onCreated,
}: {
  session: Session;
  onCreated: () => void;
}) {
  const dialogFormId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [kind, setKind] = useState('vps');
  const [hours, setHours] = useState('24');
  const [maxUses, setMaxUses] = useState('50');
  const [result, setResult] = useState<RegistrationSecret | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [, error] = useToastFeedback('error');
  const [, success] = useToastFeedback('success');
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
        <Button>创建批量令牌</Button>
      </DialogTrigger>
      <DialogContent
        title={result ? '保存批量注册令牌' : '创建批量注册令牌'}
        className="[--dialog-width:720px]"
        footer={
          result ? (
            <DialogClose asChild>
              <Button variant="secondary">关闭弹框</Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="secondary" disabled={pending} type="button">
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" loading={pending} disabled={pending} form={dialogFormId}>
                生成令牌
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
            <p className="text-text-secondary">令牌仅展示一次。关闭后无法找回，请妥善保存。</p>
            <Input
              label="批量注册令牌"
              value={result.token}
              readOnly
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.token);
                  success('批量注册令牌已复制。');
                } catch {
                  error('无法访问剪贴板，请选中令牌后手动复制。');
                }
              }}
            >
              复制令牌
            </Button>
            <p className="text-text-secondary tabular-nums">
              最多注册 {result.max_uses} 个节点，有效至{' '}
              {new Date(result.expires_at).toLocaleString('zh-CN')}。
            </p>
            <InstallInstructions registration />
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
                onCreated();
              } catch (cause) {
                error(
                  `${cause instanceof Error ? cause.message : '创建结果未确认。'} 若连接中断，请刷新列表核对，撤销未保存的令牌后再创建。`,
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
