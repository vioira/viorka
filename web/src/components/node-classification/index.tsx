import { useEffect, useState } from 'react';
import type { Session } from '@/api/auth';
import type { NodeRecord } from '@/api/nodes';
import {
  assignCategories,
  type Catalog,
  type Category,
  readCatalog,
  saveCatalog,
} from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function Classification({
  session,
  nodes,
  onChange,
  single = false,
}: {
  session: Session;
  nodes: NodeRecord[];
  onChange: () => void;
  single?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{single ? '编辑节点分类' : '管理节点分类'}</Button>
      </DialogTrigger>
      <DialogContent title={single ? '编辑节点分类' : '管理节点分类'}>
        {open && <Editor nodes={nodes} session={session} single={single} onChange={onChange} />}
      </DialogContent>
    </Dialog>
  );
}
function Editor({
  session,
  nodes,
  onChange,
  single,
}: {
  session: Session;
  nodes: NodeRecord[];
  onChange: () => void;
  single: boolean;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [epoch, setEpoch] = useState(0),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>(single && nodes[0] ? [nodes[0].id] : []);
  const [action, setAction] = useState('group'),
    [category, setCategory] = useState('none'),
    [tab, setTab] = useState('members');
  const empty = (): Category => ({ id: '', kind: 'group', name: '', shared: false });
  const [entry, setEntry] = useState<Category>(empty),
    [deleting, setDeleting] = useState(false);
  const [, error] = useToastFeedback('error', 'node-classification'),
    [, success] = useToastFeedback('success');
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter restarts the request and cancels its predecessor.
  useEffect(() => {
    const c = new AbortController();
    readCatalog(c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setCatalog(v);
          error('');
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) error(e.message);
      });
    return () => c.abort();
  }, [epoch, error]);
  async function write(change: () => Promise<void>) {
    setBusy(true);
    try {
      await change();
      setCatalog(await readCatalog());
      onChange();
      setDeleting(false);
      setEntry(empty());
      success('节点分类已更新。');
      error('');
    } catch (e) {
      error(e instanceof Error ? e.message : '更新分类失败。');
    } finally {
      setBusy(false);
    }
  }
  if (!catalog)
    return (
      <Button variant="secondary" onClick={() => setEpoch((v) => v + 1)}>
        读取分类
      </Button>
    );
  const kind = action === 'group' ? 'group' : 'tag';
  const choices = catalog.items.filter((v) => v.kind === kind);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={tab === 'members' ? 'primary' : 'secondary'}
          onClick={() => setTab('members')}
        >
          节点归类
        </Button>
        <Button
          variant={tab === 'catalog' ? 'primary' : 'secondary'}
          onClick={() => setTab('catalog')}
        >
          分类目录
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setEpoch((v) => v + 1)}>
          刷新分类
        </Button>
      </div>
      {tab === 'members' ? (
        <>
          <div className="max-h-64 space-y-2 overflow-auto">
            {nodes.map((n) => (
              <Checkbox
                key={n.id}
                label={n.name}
                description={n.categories?.map((c) => c.name).join('、') || '未分组'}
                checked={selected.includes(n.id)}
                disabled={single || busy}
                onCheckedChange={(v) =>
                  setSelected((ids) => (v ? [...ids, n.id] : ids.filter((id) => id !== n.id)))
                }
              />
            ))}
          </div>
          <Select
            label="批量操作"
            value={action}
            onValueChange={(v) => {
              setAction(v);
              setCategory('none');
            }}
            options={[
              { value: 'group', label: '移动到分组' },
              { value: 'add', label: '添加标签' },
              { value: 'remove', label: '移除标签' },
            ]}
          />
          <Select
            label={kind === 'group' ? '目标分组' : '目标标签'}
            value={category}
            onValueChange={setCategory}
            options={[
              { value: 'none', label: kind === 'group' ? '未分组' : '选择标签' },
              ...choices.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Button
            disabled={
              busy ||
              !selected.length ||
              selected.length > 256 ||
              (action !== 'group' && category === 'none')
            }
            onClick={() =>
              write(() =>
                assignCategories(
                  catalog.revision,
                  selected,
                  action,
                  category === 'none' ? '' : category,
                  session.csrf_token,
                ),
              )
            }
          >
            应用到 {selected.length} 台节点
          </Button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {catalog.items.map((c) => (
              <Button
                key={c.id}
                variant={entry.id === c.id ? 'primary' : 'secondary'}
                onClick={() => {
                  setEntry(c);
                  setDeleting(false);
                }}
              >
                {c.name}（{c.kind === 'group' ? '分组' : '标签'}）
              </Button>
            ))}
            <Button
              variant="secondary"
              onClick={() => {
                setEntry(empty());
                setDeleting(false);
              }}
            >
              新建分类
            </Button>
          </div>
          <Select
            label="类型"
            disabled={!!entry.id}
            value={entry.kind}
            options={[
              { value: 'group', label: '分组' },
              { value: 'tag', label: '标签' },
            ]}
            onValueChange={(v) => setEntry({ ...entry, kind: v as Category['kind'] })}
          />
          <Input
            label="分类名称"
            value={entry.name}
            maxLength={64}
            onChange={(e) => setEntry({ ...entry, name: e.target.value })}
          />
          <Checkbox
            label="在公开节点上展示此分类"
            checked={entry.shared}
            onCheckedChange={(v) => setEntry({ ...entry, shared: v === true })}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !entry.name.trim()}
              onClick={() =>
                write(() => {
                  const v = {
                    ...entry,
                    name: entry.name.trim(),
                    id: entry.id || crypto.randomUUID(),
                  };
                  return saveCatalog(
                    { ...catalog, items: [...catalog.items.filter((c) => c.id !== v.id), v] },
                    session.csrf_token,
                  );
                })
              }
            >
              保存分类
            </Button>
            {entry.id && (
              <Button variant="secondary" disabled={busy} onClick={() => setDeleting(true)}>
                删除分类
              </Button>
            )}
          </div>
          {deleting && (
            <div className="space-y-2">
              <p>删除“{entry.name}”会解除所有节点与它的关联。节点本身将保留。</p>
              <Button variant="secondary" onClick={() => setDeleting(false)}>
                取消
              </Button>{' '}
              <Button
                disabled={busy}
                onClick={() =>
                  write(() =>
                    saveCatalog(
                      { ...catalog, items: catalog.items.filter((c) => c.id !== entry.id) },
                      session.csrf_token,
                    ),
                  )
                }
              >
                确认删除分类
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
