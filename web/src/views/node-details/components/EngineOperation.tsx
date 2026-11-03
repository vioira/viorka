import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
export default function EngineOperation({
  title,
  description,
  disabled,
  run,
  onDone,
}: {
  title: string;
  description: string;
  disabled: boolean;
  run: (key: string) => Promise<{ id: string }>;
  onDone: () => Promise<void>;
}) {
  const { toast } = useToastStack();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const locked = useRef(false);
  async function execute() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    key.current ??= crypto.randomUUID();
    try {
      const result = await run(key.current);
      key.current = null;
      setTask(result.id);
      setOpen(false);
      toast({
        type: 'success',
        title: '引擎任务已提交',
        description: '等待 Agent 执行，任务成功前不会视为完成。',
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
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="secondary" className="min-h-11" disabled={disabled || busy}>
            {title}
          </Button>
        </DialogTrigger>
        <DialogContent title={title} description={description}>
          <div className="flex justify-end gap-3">
            <DialogClose asChild>
              <Button variant="secondary" className="min-h-11" disabled={busy}>
                取消操作
              </Button>
            </DialogClose>
            <Button
              className="min-h-11"
              loading={busy}
              disabled={busy}
              onClick={() => void execute()}
            >
              确认{title}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {task && (
        <Link to="/tasks" className="inline-flex min-h-11 items-center text-accent">
          查看任务
        </Link>
      )}
    </>
  );
}
