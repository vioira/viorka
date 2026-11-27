import { Pencil, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { type NodeRecord, renameNode } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function RenameNode({
  node,
  session,
  admin = true,
  onChanged,
}: {
  node: NodeRecord;
  session: Session;
  admin?: boolean;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  const [expected, setExpected] = useState(node.name);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, error] = useToastFeedback('error', `rename-node-${node.id}`);
  const [, success] = useToastFeedback('success');

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    setName(node.name);
    setExpected(node.name);
    setEditing(true);
  }

  function cancelEdit() {
    if (busy.current) return;
    setName(node.name);
    setEditing(false);
  }

  async function submit() {
    if (busy.current) return;
    const trimmed = name.trim();
    if (!trimmed || new TextEncoder().encode(trimmed).length > 128) {
      error('请输入 1 到 128 字节的节点名称。');
      return;
    }
    if (trimmed === expected) {
      setEditing(false);
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      await renameNode(node.id, trimmed, expected, session);
      setEditing(false);
      success('节点名称已更新。');
      await onChanged();
    } catch (cause) {
      error(cause instanceof Error ? cause.message : '修改未确认，请刷新节点后重试。');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-(length:--text-sm) font-medium text-foreground">节点名称</div>
        {editing ? (
          <div className="flex max-w-md flex-wrap items-center gap-2 pt-1">
            <div className="min-w-[180px] flex-1">
              <Input
                ref={inputRef}
                label="节点名称"
                hideLabel
                value={name}
                maxLength={128}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submit();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelEdit();
                  }
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              loading={pending}
              disabled={pending || !name.trim() || name.trim() === expected}
              onClick={() => void submit()}
            >
              <Save size={14} aria-hidden="true" />
              保存名称
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={cancelEdit}
            >
              取消
            </Button>
          </div>
        ) : (
          <p className="wrap-anywhere text-(length:--text-sm) text-text-secondary">{node.name}</p>
        )}
      </div>
      {admin && !editing && (
        <Button type="button" variant="secondary" size="sm" onClick={startEdit}>
          <Pencil size={14} aria-hidden="true" />
          修改名称
        </Button>
      )}
    </div>
  );
}
