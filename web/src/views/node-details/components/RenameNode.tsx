import { useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { type NodeRecord, renameNode } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function RenameNode({
  node,
  session,
  onChanged,
}: {
  node: NodeRecord;
  session: Session;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [expected, setExpected] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [, error] = useToastFeedback('error');
  const [, success] = useToastFeedback('success');
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy.current) return;
        if (value) {
          setName(node.name);
          setExpected(node.name);
        }
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">修改名称</Button>
      </DialogTrigger>
      <DialogContent data-node-management="" title="修改节点名称">
        <form
          className="space-y-6"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy.current) return;
            if (!name.trim() || new TextEncoder().encode(name.trim()).length > 128) {
              error('请输入 1 到 128 字节的节点名称。');
              return;
            }
            busy.current = true;
            setPending(true);
            try {
              await renameNode(node.id, name, expected, session);
              setOpen(false);
              success('节点名称已更新。');
              await onChanged();
            } catch (cause) {
              error(cause instanceof Error ? cause.message : '修改未确认，请刷新节点后重试。');
            } finally {
              busy.current = false;
              setPending(false);
            }
          }}
        >
          <Input
            label="节点名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={128}
            disabled={pending}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              取消修改
            </Button>
            <Button
              type="submit"
              loading={pending}
              disabled={pending || !name.trim() || name.trim() === expected}
            >
              保存名称
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
