import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { listAllNodes, type NodeRecord } from '@/api/nodes';
import {
  type Publication,
  previewStatus,
  publishStatus,
  readPublication,
  type StatusPage,
} from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Input } from '@/components/arc/input/input';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import StatusOverview from '@/views/public-status/components/StatusOverview';

export default function StatusSettings() {
  const session = useOutletContext<Session>();
  const [nodes, setNodes] = useState<NodeRecord[]>([]),
    [saved, setSaved] = useState<Publication | null>(null),
    [draft, setDraft] = useState<Publication | null>(null);
  const [preview, setPreview] = useState<StatusPage | null>(null),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const [, error] = useToastFeedback('error', 'status-publication'),
    [, success] = useToastFeedback('success');
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter restarts the request and cancels its predecessor.
  useEffect(() => {
    if (session.user.role !== 'admin') return;
    const c = new AbortController();
    Promise.all([readPublication(c.signal), listAllNodes(c.signal)])
      .then(([p, n]) => {
        if (!c.signal.aborted) {
          setSaved(p);
          setDraft(p);
          setNodes(n);
          setPreview(null);
          error('');
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) error(e.message);
      });
    return () => c.abort();
  }, [reload, session.user.role, error]);
  const edit = (p: Publication) => {
    setDraft(p);
    setPreview(null);
  };
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      error('');
    } catch (e) {
      error(e instanceof Error ? e.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function save(p: Publication, remainingDraft: Publication = p) {
    await publishStatus(p, session.csrf_token);
    const next = { ...p, revision: p.revision + 1 };
    setSaved(next);
    setDraft({ ...remainingDraft, enabled: next.enabled, revision: next.revision });
    setPreview(null);
    success(p.enabled ? '公开状态页已更新。' : '公开状态页已关闭。');
  }
  if (session.user.role !== 'admin') return <p>仅管理员可管理公开状态页。</p>;
  const refresh = (
    <Button variant="secondary" disabled={busy} onClick={() => setReload((v) => v + 1)}>
      重新读取配置
    </Button>
  );
  if (!draft || !saved)
    return (
      <div className="space-y-3">
        <p>发布配置尚未读取。</p>
        {refresh}
      </div>
    );
  const entries = draft.nodes,
    enabled = { ...draft, enabled: true };
  const move = (index: number, offset: number) => {
    const next = [...entries];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    edit({ ...draft, nodes: next });
  };
  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">公开状态页</h2>
          <p className="text-sm text-text-secondary">
            {saved.enabled ? '已发布，任何持有链接的人均可访问。' : '当前未开放。'}
          </p>
        </div>
        <div className="flex gap-2">
          {refresh}
          {saved.enabled && (
            <Button
              variant="secondary"
              onClick={() =>
                run(async () => {
                  await navigator.clipboard.writeText(new URL('/status', location.origin).href);
                  success('公开链接已复制。');
                })
              }
            >
              复制公开链接
            </Button>
          )}
        </div>
      </header>
      <fieldset disabled={busy} className="grid gap-3">
        <legend className="mb-2 font-medium">选择公开节点</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {nodes.map((n) => (
            <Checkbox
              key={n.id}
              label={n.name}
              checked={entries.some((e) => e.id === n.id)}
              onCheckedChange={(checked) =>
                edit({
                  ...draft,
                  nodes: checked
                    ? [...entries, { id: n.id, alias: n.name }]
                    : entries.filter((e) => e.id !== n.id),
                })
              }
            />
          ))}
        </div>
        {!nodes.length && <p>暂无节点。</p>}
      </fieldset>
      {entries.length > 0 && (
        <section className="space-y-2">
          <h3>展示顺序和公开资料</h3>
          {entries.map((n, i) => (
            <div key={n.id} className="flex flex-wrap items-end gap-3 border-b border-border py-3">
              <span className="min-w-28 break-words">{nodes.find((v) => v.id === n.id)?.name}</span>
              <Input
                label="公开别名"
                maxLength={96}
                value={n.alias}
                disabled={busy}
                onChange={(e) =>
                  edit({
                    ...draft,
                    nodes: entries.map((v) =>
                      v.id === n.id ? { ...v, alias: e.target.value } : v,
                    ),
                  })
                }
              />
              <div className="w-36">
                <Input
                  label="CPU 核数（可选）"
                  type="number"
                  min={1}
                  max={65536}
                  value={n.cpu_cores ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    edit({
                      ...draft,
                      nodes: entries.map((v) =>
                        v.id === n.id
                          ? { ...v, cpu_cores: e.target.value ? Number(e.target.value) : undefined }
                          : v,
                      ),
                    })
                  }
                />
              </div>
              <Button
                variant="secondary"
                aria-label={`上移 ${n.alias}`}
                disabled={busy || i === 0}
                onClick={() => move(i, -1)}
              >
                上移
              </Button>
              <Button
                variant="secondary"
                aria-label={`下移 ${n.alias}`}
                disabled={busy || i === entries.length - 1}
                onClick={() => move(i, 1)}
              >
                下移
              </Button>
              {saved.enabled && saved.nodes.some((v) => v.id === n.id) && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      save(
                        {
                          ...saved,
                          nodes: saved.nodes.filter((v) => v.id !== n.id),
                          enabled: saved.nodes.length > 1,
                        },
                        { ...draft, nodes: entries.filter((v) => v.id !== n.id) },
                      ),
                    )
                  }
                >
                  立即撤下
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || !entries.length}
          onClick={() =>
            run(async () => setPreview(await previewStatus(enabled, session.csrf_token)))
          }
        >
          预览公开页
        </Button>
        <Button disabled={busy || !preview} onClick={() => run(() => save(enabled))}>
          发布状态页
        </Button>
        {saved.enabled && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => run(() => save({ ...saved, enabled: false }, draft))}
          >
            关闭公开页
          </Button>
        )}
      </div>
      {preview && (
        <section className="space-y-3 border-t border-border pt-4">
          <h2 className="font-medium">访客预览</h2>
          <StatusOverview preview page={preview} now={Date.parse(preview.at)} />
        </section>
      )}
    </div>
  );
}
