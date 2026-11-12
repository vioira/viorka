import { type ReactNode, useRef, useState } from 'react';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
export default function EngineOperation({
  title,
  children,
  description,
  disabled,
  run,
  onDone,
  open: controlledOpen,
  onOpenChange,
  returnFocus,
  variant = 'secondary',
}: {
  children?: (locked: boolean) => ReactNode;
  returnFocus?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: 'primary' | 'secondary';
  title: string;
  description: string;
  disabled: boolean;
  run: (key: string) => Promise<{ id?: string; local_only?: boolean }>;
  onDone: () => Promise<void>;
}) {
  const { toast } = useToastStack();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const locked = useRef(false);
  async function execute() {
    if (locked.current || disabled) return;
    locked.current = true;
    setBusy(true);
    key.current ??= crypto.randomUUID();
    try {
      const result = await run(key.current);
      key.current = null;
      setOpen(false);
      toast({
        type: 'success',
        title: result.local_only ? '已保存' : '引擎任务已提交',
        description: result.local_only ? undefined : '等待 Agent 执行，任务成功前不会视为完成。',
      });
      await onDone();
    } catch (error) {
      toast({
        id: `engine-${title}`,
        type: 'error',
        title: '引擎任务提交未确认',
        description: error instanceof Error ? error.message : '请重试，同一操作会复用请求标识。',
      });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          <Button variant={variant} disabled={disabled || busy}>
            {title}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        title={title}
        description={description}
        onCloseAutoFocus={
          returnFocus
            ? (event) => {
                event.preventDefault();
                returnFocus();
              }
            : undefined
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                取消操作
              </Button>
            </DialogClose>
            <Button loading={busy} disabled={busy || disabled} onClick={() => void execute()}>
              确认{title}
            </Button>
          </>
        }
      >
        {children?.(busy || key.current !== null)}
      </DialogContent>
    </Dialog>
  );
}
