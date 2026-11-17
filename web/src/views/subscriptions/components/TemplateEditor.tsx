import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  previewSubscriptionTemplate,
  type SubscriptionReplacement,
  type SubscriptionTemplate,
  type SubscriptionTemplateEdit,
  saveSubscriptionTemplate,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import { Textarea } from '@/components/arc/textarea/textarea';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EditorWorkspace from './EditorWorkspace';
import { useDialogFocus } from './useDialogFocus';

type EditableReplacement = SubscriptionReplacement & { key: string };
export default function TemplateEditor({
  source,
  existing,
  session,
  onClose,
  onSaved,
}: {
  source: SubscriptionTemplate;
  existing: boolean;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useId();
  const confirmationFocus = useDialogFocus();
  const { toast } = useToastStack();
  const [name, setName] = useState(existing ? source.name : `${source.name} 副本`);
  const format = source.format;
  const [body, setBody] = useState(source.body);
  const [script, setScript] = useState(source.script);
  const [replacements, setReplacements] = useState<EditableReplacement[]>(() =>
    source.replacements.map((r, i) => ({ ...r, key: `initial-${i}` })),
  );
  const [userAgent, setUserAgent] = useState('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [previewSource, setPreviewSource] = useState('');
  function edit(confirm = false): SubscriptionTemplateEdit {
    return {
      name: name.trim(),
      format,
      body,
      script,
      replacements: replacements.map(({ key: _, ...r }) => r),
      version: existing ? source.version : 0,
      expected_references: existing ? source.references : 0,
      confirm,
    };
  }
  function updateReplacement(key: string, change: Partial<SubscriptionReplacement>) {
    setReplacements((old) => old.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }
  async function save(confirm = false) {
    if (busy) return;
    if (existing && source.references > 0 && !confirm) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await saveSubscriptionTemplate(existing ? source.id : null, edit(confirm), session);
      toast({ type: 'success', title: '配置模板已保存' });
      onSaved();
    } catch (error) {
      toast({
        id: 'subscription-template-save',
        type: 'error',
        title: '未能保存配置模板',
        description: error instanceof Error ? error.message : '请检查配置内容后重试。',
      });
    } finally {
      setBusy(false);
    }
  }
  async function renderPreview() {
    if (busy || previewing) return;
    setPreviewing(true);
    try {
      const params: Record<string, string> = {};
      for (const [key, value] of new URLSearchParams(query)) {
        if (Object.hasOwn(params, key)) throw new Error('预览参数不能重复。');
        params[key] = value;
      }
      const result = await previewSubscriptionTemplate(edit(), userAgent, params, session);
      setPreview(result.body);
      setPreviewSource(JSON.stringify([body, script, replacements, userAgent, query]));
      toast({ type: 'success', title: '配置预览已生成' });
    } catch (error) {
      toast({
        id: 'subscription-template-preview',
        type: 'error',
        title: '未能生成配置预览',
        description: error instanceof Error ? error.message : '请检查配置、替换条件和脚本。',
      });
    } finally {
      setPreviewing(false);
    }
  }
  const dirty =
    name !== (existing ? source.name : `${source.name} 副本`) ||
    body !== source.body ||
    script !== source.script ||
    JSON.stringify(replacements.map(({ key: _, ...r }) => r)) !==
      JSON.stringify(source.replacements);
  const previewStale =
    preview !== null &&
    previewSource !== JSON.stringify([body, script, replacements, userAgent, query]);
  function moveReplacement(index: number, direction: number) {
    setReplacements((old) => {
      const next = [...old];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }
  return (
    <>
      <EditorWorkspace
        title={existing ? '编辑配置模板' : '创建配置模板'}
        subtitle={`${format} 格式${existing ? `，${source.references} 条应用规则引用` : `，基于 ${source.name}`}`}
        form={form}
        saveLabel="保存模板"
        busy={busy}
        dirty={dirty}
        onClose={onClose}
      >
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,1fr)]">
          <form
            id={form}
            className="min-w-0"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy} className="min-w-0 space-y-5">
              <Input
                label="模板名称"
                value={name}
                required
                maxLength={128}
                onChange={(event) => setName(event.target.value)}
              />
              <Tabs defaultValue="config">
                <TabsList aria-label="模板编辑内容">
                  <TabsTrigger value="config">配置正文</TabsTrigger>
                  <TabsTrigger value="replace">
                    正则替换{replacements.length ? ` (${replacements.length})` : ''}
                  </TabsTrigger>
                  <TabsTrigger value="script">JavaScript</TabsTrigger>
                </TabsList>
                <TabsContent value="config" className="space-y-4">
                  <Textarea
                    label={`${format} 配置`}
                    rows={24}
                    value={body}
                    maxLength={131072}
                    spellCheck={false}
                    className="font-mono text-sm"
                    aria-describedby={`${form}-body-hint`}
                    onChange={(event) => setBody(event.target.value)}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p id={`${form}-body-hint`} className="text-xs text-(--text-secondary)">
                      编辑 DNS、代理组与分流规则，节点由变量填入。
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={showVariables}
                      aria-controls={`${form}-variables`}
                      onClick={() => setShowVariables(!showVariables)}
                    >
                      {showVariables ? '收起变量说明' : '查看可用变量'}
                    </Button>
                  </div>
                  {showVariables && (
                    <dl
                      id={`${form}-variables`}
                      className="grid grid-cols-1 gap-2 border-t border-(--border-subtle) pt-4 text-sm sm:grid-cols-[auto_1fr]"
                    >
                      <dt className="font-mono">{'{{proxies}}'}</dt>
                      <dd>节点配置；sing-box 为逗号分隔的出口对象</dd>
                      <dt className="font-mono">{'{{proxy_names}}'}</dt>
                      <dd>节点名称列表</dd>
                      <dt className="font-mono">{'{{proxy_choices}}'}</dt>
                      <dd>节点名称与直连选项</dd>
                      <dt className="font-mono">{'{{default_proxy}}'}</dt>
                      <dd>首个可用节点名称</dd>
                      <dt className="font-mono">{'{{port}}'}</dt>
                      <dd>Mihomo 本机端口</dd>
                      <dd className="text-xs text-(--text-secondary) sm:col-span-2">
                        Mihomo、sing-box 名称使用 JSON 数组或字符串，自带引号；Loon
                        使用逗号分隔文本。
                      </dd>
                    </dl>
                  )}
                </TabsContent>
                <TabsContent value="replace" className="space-y-5">
                  <p className="text-sm text-(--text-secondary)">
                    从上到下替换配置全文，再执行 JavaScript。捕获组写作 ${'{1}'}。
                  </p>
                  {!replacements.length && (
                    <p className="border-y border-(--border-subtle) py-10 text-center text-sm text-(--text-secondary)">
                      尚未添加替换规则
                    </p>
                  )}
                  {replacements.map((r, index) => (
                    <section
                      key={r.key}
                      aria-label={`替换 ${index + 1}`}
                      className="space-y-4 border-b border-(--border-subtle) pb-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-medium">替换 {index + 1}</h3>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`上移替换 ${index + 1}`}
                            disabled={index === 0}
                            onClick={() => moveReplacement(index, -1)}
                          >
                            <ArrowUp size={16} aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`下移替换 ${index + 1}`}
                            disabled={index === replacements.length - 1}
                            onClick={() => moveReplacement(index, 1)}
                          >
                            <ArrowDown size={16} aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`移除替换 ${index + 1}`}
                            onClick={() =>
                              setReplacements((old) => old.filter((item) => item.key !== r.key))
                            }
                          >
                            <X size={16} aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      <Input
                        label="正则表达式"
                        value={r.pattern}
                        maxLength={1024}
                        onChange={(event) =>
                          updateReplacement(r.key, { pattern: event.target.value })
                        }
                      />
                      <Input
                        label="替换为"
                        value={r.replacement}
                        maxLength={4096}
                        onChange={(event) =>
                          updateReplacement(r.key, { replacement: event.target.value })
                        }
                      />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Input
                          label="条件参数（留空时始终执行）"
                          placeholder="support-x25519mlkem768"
                          value={r.parameter}
                          maxLength={64}
                          onChange={(event) =>
                            updateReplacement(r.key, { parameter: event.target.value })
                          }
                        />
                        <Input
                          label="参数等于"
                          placeholder="true"
                          value={r.value}
                          maxLength={256}
                          disabled={!r.parameter}
                          onChange={(event) =>
                            updateReplacement(r.key, { value: event.target.value })
                          }
                        />
                      </div>
                    </section>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={replacements.length >= 32}
                    onClick={() =>
                      setReplacements((old) => [
                        ...old,
                        {
                          key: crypto.randomUUID(),
                          pattern: '',
                          replacement: '',
                          parameter: '',
                          value: '',
                        },
                      ])
                    }
                  >
                    添加替换规则
                  </Button>
                </TabsContent>
                <TabsContent value="script" className="space-y-4">
                  <Textarea
                    label="配置处理脚本"
                    rows={24}
                    maxLength={16384}
                    value={script}
                    spellCheck={false}
                    className="font-mono text-sm"
                    aria-describedby={`${form}-script-hint`}
                    onChange={(event) => setScript(event.target.value)}
                    placeholder={
                      'if (context.params["support-x25519mlkem768"] === "true") {\n  config = config.replace(/(fp=|tls-profile=)chrome(?=,|$)/gm, "$1chrome147");\n}\nreturn config;'
                    }
                  />
                  <div
                    id={`${form}-script-hint`}
                    className="space-y-2 text-xs text-(--text-secondary) [overflow-wrap:anywhere]"
                  >
                    <p>config 是替换后的配置字符串，必须 return 配置字符串；留空则跳过。</p>
                    <p>context.userAgent 为客户端标识，context.params 为链接参数。</p>
                    <p>执行上限 100 毫秒，不提供网络、文件或系统命令接口。</p>
                  </div>
                </TabsContent>
              </Tabs>
            </fieldset>
          </form>
          <aside
            aria-label="模板预览"
            className="min-w-0 space-y-5 border-t border-(--border-subtle) pt-6 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-medium">输出预览</h3>
                <p className="mt-1 text-xs text-(--text-secondary)">
                  使用示例节点，执行当前未保存配置。
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={busy}
                loading={previewing}
                onClick={() => void renderPreview()}
              >
                生成预览
              </Button>
            </div>
            <Input
              label="预览 User-Agent"
              value={userAgent}
              maxLength={1024}
              disabled={busy}
              onChange={(event) => setUserAgent(event.target.value)}
              placeholder="例如：Loon/3.3"
            />
            <Input
              label="预览链接参数"
              value={query}
              maxLength={8192}
              disabled={busy}
              placeholder="support-x25519mlkem768=true"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Textarea
              label={previewStale ? '预览内容（修改后需重新生成）' : '预览内容（示例节点）'}
              rows={24}
              readOnly
              spellCheck={false}
              value={preview ?? ''}
              placeholder="生成后显示完整配置"
              className="font-mono text-sm"
            />
          </aside>
        </div>
      </EditorWorkspace>
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
      >
        <DialogContent
          {...confirmationFocus}
          data-subscription-management
          title="保存共享配置模板？"
          description={`“${source.name}”被 ${source.references} 条应用规则引用。保存后，关联订阅下次拉取将使用新配置。`}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                继续编辑
              </Button>
              <Button loading={busy} onClick={() => void save(true)}>
                确认保存模板
              </Button>
            </>
          }
        />
      </Dialog>
    </>
  );
}
