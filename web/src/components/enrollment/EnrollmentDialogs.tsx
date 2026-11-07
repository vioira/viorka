import { CircleHelp, Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Session } from '@/api/auth';
import { createEnrollment, type Enrollment, type NodeKind } from '@/api/enrollment';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import { EnrollmentToken } from './EnrollmentToken';
import { InstallInstructions } from './InstallInstructions';

const kinds = [
  { value: 'vps', label: '公网 VPS' },
  { value: 'nat', label: 'NAT VPS' },
];
const steps = [
  ['在面板生成令牌', '填写节点名称与类型，令牌有效期为 15 分钟。'],
  ['执行安装命令', '复制包含一次性令牌的安装命令到 Linux 节点执行。'],
  ['签名挑战并建立 WSS', 'Agent 本地生成密钥，面板只保存公钥。'],
  ['检查节点连接', '确认节点在线，完成首次只读检查。'],
];

export function EnrollmentGuide() {
  return (
    <Dialog>
      <Tooltip content="查看注册流程">
        <DialogTrigger asChild>
          <Button variant="ghost" className="min-h-11 min-w-11" aria-label="查看注册流程">
            <CircleHelp size={18} aria-hidden="true" />
          </Button>
        </DialogTrigger>
      </Tooltip>
      <DialogContent
        title="注册流程"
        description="使用一次性令牌，将节点上的 Agent 连接到面板。"
        footer={
          <DialogClose asChild>
            <Button variant="secondary">关闭流程</Button>
          </DialogClose>
        }
      >
        <ol className="space-y-6">
          {steps.map(([title, description], index) => (
            <li key={title} className="flex gap-4">
              <span className="text-text-secondary tabular-nums" aria-hidden="true">
                {index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="font-medium text-foreground">{title}</h3>
                <p className="mt-2 text-(length:--text-xs) text-text-secondary leading-relaxed">
                  {description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

export function GenerateEnrollment({
  session,
  disabled,
  onCreated,
  triggerLabel = '添加节点',
  onViewNodes,
}: {
  session: Session;
  disabled: boolean;
  onCreated?: () => Promise<void>;
  triggerLabel?: string;
  onViewNodes?: () => void;
}) {
  const dialogFormId = useId();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<NodeKind>('vps');
  const [result, setResult] = useState<Enrollment | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [, setError] = useToastFeedback('error');
  const [, setNotice] = useToastFeedback('success');

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(
      () => {
        setResult(null);
        setExpired(true);
      },
      Math.max(0, Date.parse(result.expires_at) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [result]);

  async function generate() {
    if (session.user.role !== 'admin' || busy.current || result || expired) return;
    if (!name.trim() || new TextEncoder().encode(name.trim()).length > 128) {
      setError('请输入 1 到 128 字节的节点名称。');
      return;
    }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const token = await createEnrollment(session, name, kind);
      setResult(token);
      setNotice('节点已添加，请在有效期内执行安装命令。');
      try {
        await onCreated?.();
      } catch {
        setError('节点已添加，但列表刷新失败，请稍后刷新节点。');
      }
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : '无法生成令牌。'} 若请求超时或连接中断，创建结果可能未知；请勿连续重复提交，未使用的令牌将在 15 分钟后过期。`,
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy.current) return;
        setOpen(value);
        if (!value) {
          setResult(null);
          setExpired(false);
          setName('');
          setKind('vps');
          setError('');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Plus size={16} aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={triggerLabel}
        className="[--dialog-width:720px]"
        description="生成令牌时创建节点。令牌 15 分钟内有效，用于绑定该节点的 Agent 身份。"
        onPointerDownOutside={(event) => {
          if (result) event.preventDefault();
        }}
        footer={
          result || expired ? (
            <>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setResult(null);
                  setExpired(false);
                  setName('');
                  setKind('vps');
                  if (onViewNodes) onViewNodes();
                  else navigate('/nodes');
                }}
              >
                查看节点
              </Button>
              <DialogClose asChild>
                <Button variant="secondary" disabled={pending}>
                  关闭弹框
                </Button>
              </DialogClose>
            </>
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
      >
        {result || expired ? (
          <div className="space-y-5">
            <p className="break-all text-text-secondary">
              {name.trim()} / {kinds.find((item) => item.value === kind)?.label}
            </p>
            {result ? (
              <EnrollmentToken enrollment={result} />
            ) : (
              <p role="status" className="text-text-secondary">
                令牌已过期，明文已清除，节点记录仍保留。可进入节点详情，点击“安装 Agent”重新生成。
              </p>
            )}
            {result && <InstallInstructions token={result.token} />}
            <p className="text-(length:--text-xs) text-text-secondary">
              节点记录已创建，Agent 尚需注册并启动才能在线。关闭或到期后，可从该节点的“安装
              Agent”入口重新生成命令。
            </p>
          </div>
        ) : (
          <form
            id={dialogFormId}
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
          >
            <fieldset disabled={pending} className="min-w-0 space-y-5">
              <Input
                label="节点名称"
                placeholder="例如 jp-nat-03"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={128}
              />
              <SegmentedControl
                label="节点类型"
                value={kind}
                onValueChange={(value) => setKind(value as NodeKind)}
                options={kinds}
              />
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
