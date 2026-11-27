import { ArrowDown, ArrowUp, Copy, Eye, History, Info, Plus, RefreshCw, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  previewSubscriptionTemplate,
  type SubscriptionReplacement,
  type SubscriptionTemplate,
  type SubscriptionTemplateEdit,
  saveSubscriptionTemplate,
} from '@/api/subscriptions';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { Textarea } from '@/components/arc/textarea/textarea';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import InitialSkeleton from '@/components/initial-skeleton';
import EditorWorkspace from './components/EditorWorkspace';
import TemplateHistoryDrawer from './components/TemplateHistoryDrawer';
import TemplateReviewDialog, { templateParams } from './components/TemplateReviewDialog';
import { useSubscriptionsContext } from './context';

type EditableReplacement = SubscriptionReplacement & { key: string };
type PipelineStage = 'config' | 'replace' | 'script';

const templateVariables = [
  { token: '{{proxies}}', desc: '节点配置；sing-box 为逗号分隔的出口对象' },
  { token: '{{proxy_names}}', desc: '节点名称列表，不含直连' },
  { token: '{{proxy_choices}}', desc: '节点名称与直连选项' },
  { token: '{{default_proxy}}', desc: '首个可用节点名称' },
  { token: '{{port}}', desc: 'Mihomo 本机端口' },
];

export default function TemplateWorkbenchPage() {
  const { templateId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { session, isAdmin, templates, templatesLoading, reloadTemplates, reloadRules } =
    useSubscriptionsContext();

  if (!isAdmin) return <Navigate to="/subscriptions/templates" replace />;

  const existing = Boolean(templateId);
  const fromId = searchParams.get('from');
  const source = templates
    ? existing
      ? templates.find((item) => item.id === templateId)
      : (templates.find((item) => item.id === fromId) ??
        templates.find((item) => item.builtin) ??
        templates[0])
    : undefined;

  if (!templates) {
    return (
      <section className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void navigate('/subscriptions/templates')}
          >
            返回配置模板
          </Button>
          {!templatesLoading && (
            <Button variant="secondary" size="sm" onClick={() => void reloadTemplates()}>
              <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
              重新读取
            </Button>
          )}
        </div>
        {templatesLoading ? (
          <InitialSkeleton label="正在读取配置模板" lines={6} />
        ) : (
          <div className="rounded-(--radius-panel) border-[1px] border-border bg-surface p-8 text-center text-(length:--text-sm) text-text-secondary">
            未能读取配置模板，请重新读取或返回列表。
          </div>
        )}
      </section>
    );
  }

  if (!source) {
    return (
      <section className="min-w-0 space-y-5">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void navigate('/subscriptions/templates')}
        >
          返回配置模板
        </Button>
        <div className="rounded-(--radius-panel) border-[1px] border-border bg-surface p-8 text-center text-(length:--text-sm) text-text-secondary">
          未找到指定的配置模板。
        </div>
      </section>
    );
  }

  return (
    <TemplateWorkbenchForm
      key={`${existing ? 'edit' : 'new'}:${source.id}:${source.version}`}
      source={source}
      existing={existing}
      session={session}
      onClose={() => void navigate('/subscriptions/templates')}
      onSaved={() => {
        void reloadTemplates();
        void reloadRules();
        void navigate('/subscriptions/templates');
      }}
      onRestored={() => {
        void reloadTemplates();
        void reloadRules();
      }}
    />
  );
}

function TemplateWorkbenchForm({
  source,
  existing,
  session,
  onClose,
  onSaved,
  onRestored,
}: {
  source: SubscriptionTemplate;
  existing: boolean;
  session: import('@/api/auth').Session;
  onClose: () => void;
  onSaved: () => void;
  onRestored: () => void;
}) {
  const form = useId();
  const { toast } = useToastStack();

  const initialName = existing ? source.name : `${source.name} 副本`;
  const [name, setName] = useState(initialName);
  const [stage, setStage] = useState<PipelineStage>('config');
  const [body, setBody] = useState(source.body);
  const [script, setScript] = useState(source.script);
  const [replacements, setReplacements] = useState<EditableReplacement[]>(() =>
    source.replacements.map((item, index) => ({ ...item, key: `initial-${index}` })),
  );
  const [showVariables, setShowVariables] = useState(false);
  const [userAgent, setUserAgent] = useState('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const format = source.format;

  function buildEdit(confirm = false): SubscriptionTemplateEdit {
    return {
      name: name.trim(),
      format,
      body,
      script,
      replacements: replacements.map(({ key: _, ...item }) => item),
      version: existing ? source.version : 0,
      expected_references: existing ? source.references : 0,
      confirm,
    };
  }

  function updateReplacement(key: string, change: Partial<SubscriptionReplacement>) {
    setReplacements((old) => old.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }

  function moveReplacement(index: number, direction: number) {
    setReplacements((old) => {
      const next = [...old];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }

  async function save(confirm = false) {
    if (busy) return;
    if (!name.trim()) {
      toast({
        id: 'subscription-template-validation',
        type: 'error',
        title: '请填写模板名称',
      });
      return;
    }
    if (existing && source.references > 0 && !confirm) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await saveSubscriptionTemplate(existing ? source.id : null, buildEdit(confirm), session);
      setConfirming(false);
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
      const params = templateParams(query);
      const result = await previewSubscriptionTemplate(buildEdit(), userAgent, params, session);
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

  async function copyPreview() {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview);
      toast({ type: 'success', title: '预览内容已复制' });
    } catch {
      toast({
        id: 'template-preview-copy',
        type: 'error',
        title: '未能复制预览内容',
        description: '请手动选中预览内容复制。',
      });
    }
  }

  const dirty =
    name !== initialName ||
    body !== source.body ||
    script !== source.script ||
    JSON.stringify(replacements.map(({ key: _, ...item }) => item)) !==
      JSON.stringify(source.replacements);

  const previewStale =
    preview !== null &&
    previewSource !== JSON.stringify([body, script, replacements, userAgent, query]);

  return (
    <>
      <EditorWorkspace
        breadcrumb={existing ? `配置模板 / ${source.name}` : '新建配置模板'}
        title={existing ? source.name : '创建配置模板'}
        subtitle={
          existing
            ? `${source.references} 条应用规则引用，格式创建后固定`
            : `基于 ${source.name} 复制，格式固定为 ${format}`
        }
        backLabel="配置模板"
        meta={
          <>
            <Badge tone="neutral" size="sm" className="font-mono">
              {format}
            </Badge>
            {existing && (
              <Badge tone="neutral" size="sm" className="tabular-nums">
                v{source.version}
              </Badge>
            )}
            {dirty && (
              <Badge tone="warning" size="sm">
                未保存更改
              </Badge>
            )}
          </>
        }
        actions={
          existing ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setHistoryOpen(true)}
            >
              <History size={15} strokeWidth={1.75} aria-hidden="true" />
              版本历史
            </Button>
          ) : undefined
        }
        form={form}
        saveLabel="保存模板"
        busy={busy}
        dirty={dirty}
        onClose={onClose}
      >
        <div className="grid min-w-0 items-start gap-6 xl:grid-cols-12">
          {/* Left Pane: 3-Stage Processing Pipeline Editor */}
          <form
            id={form}
            className="min-w-0 rounded-(--radius-panel) border-[1px] border-border bg-surface p-5 xl:col-span-7"
            onSubmit={(event) => {
              event.preventDefault();
              void save(false);
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

              {/* Visual 3-Stage Pipeline Switcher */}
              <div
                role="tablist"
                aria-label="模板处理阶段"
                className="grid grid-cols-1 gap-2 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted p-1 sm:grid-cols-3"
              >
                {(
                  [
                    { id: 'config', title: '1. 配置正文', detail: '节点变量注入' },
                    {
                      id: 'replace',
                      title: `2. 正则替换 (${replacements.length})`,
                      detail: 'Go RE2 条件替换',
                    },
                    {
                      id: 'script',
                      title: '3. JavaScript',
                      detail: script.trim() ? '已配置脚本' : '可选后处理',
                    },
                  ] as const
                ).map((step) => {
                  const active = stage === step.id;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`cursor-pointer rounded-(--radius-control) border-[1px] px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-border bg-surface text-foreground'
                          : 'border-transparent bg-transparent text-text-secondary hover:text-foreground'
                      }`}
                      onClick={() => setStage(step.id)}
                    >
                      <div className="text-(length:--text-xs) font-medium">{step.title}</div>
                      <div className="mt-0.5 truncate text-(length:--text-xs) text-text-secondary">
                        {step.detail}
                      </div>
                    </button>
                  );
                })}
              </div>

              {stage === 'config' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-(length:--text-xs) text-text-secondary">
                      点击追加模板变量
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {templateVariables.map((item) => (
                        <Button
                          key={item.token}
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="font-mono"
                          onClick={() => {
                            setBody((previous) =>
                              previous.endsWith('\n') || !previous
                                ? `${previous}${item.token}`
                                : `${previous}\n${item.token}`,
                            );
                            toast({ type: 'info', title: `已追加变量 ${item.token}` });
                          }}
                        >
                          {item.token}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Textarea
                    label={`${format} 配置正文`}
                    rows={22}
                    value={body}
                    maxLength={131072}
                    spellCheck={false}
                    className="font-mono text-(length:--text-sm)"
                    aria-describedby={`${form}-body-hint`}
                    onChange={(event) => setBody(event.target.value)}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p
                      id={`${form}-body-hint`}
                      className="text-(length:--text-xs) text-text-secondary"
                    >
                      编辑 DNS、代理组与分流规则，节点由变量填入。
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={showVariables}
                      aria-controls={`${form}-variables`}
                      onClick={() => setShowVariables((prev) => !prev)}
                    >
                      <Info size={15} strokeWidth={1.75} aria-hidden="true" />
                      {showVariables ? '收起变量说明' : '查看变量说明'}
                    </Button>
                  </div>
                  {showVariables && (
                    <dl
                      id={`${form}-variables`}
                      className="grid grid-cols-1 gap-2 border-t-[1px] border-border-subtle pt-4 text-(length:--text-xs) sm:grid-cols-[auto_1fr]"
                    >
                      {templateVariables.map((item) => (
                        <div key={item.token} className="contents">
                          <dt className="font-mono text-foreground">{item.token}</dt>
                          <dd className="text-text-secondary">{item.desc}</dd>
                        </div>
                      ))}
                      <dd className="text-text-secondary sm:col-span-2">
                        Mihomo、sing-box 名称列表使用 JSON 数组或字符串并自带引号；Loon
                        使用逗号分隔文本。
                      </dd>
                    </dl>
                  )}
                </div>
              )}

              {stage === 'replace' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-(length:--text-xs) text-text-secondary">
                      从上到下替换配置全文，再执行 JavaScript。捕获组写作 ${'{1}'}。
                    </p>
                    <Button
                      type="button"
                      size="sm"
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
                      <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                      添加替换规则
                    </Button>
                  </div>
                  {replacements.length === 0 && (
                    <p className="rounded-(--radius-control) border-[1px] border-border-subtle py-10 text-center text-(length:--text-sm) text-text-secondary">
                      尚未添加正则替换规则
                    </p>
                  )}
                  {replacements.map((item, index) => (
                    <section
                      key={item.key}
                      aria-label={`替换 ${index + 1}`}
                      className="space-y-3 rounded-(--radius-control) border-[1px] border-border-subtle p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-(length:--text-xs) font-medium">替换 {index + 1}</h3>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`上移替换 ${index + 1}`}
                            disabled={index === 0}
                            onClick={() => moveReplacement(index, -1)}
                          >
                            <ArrowUp size={15} strokeWidth={1.75} aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`下移替换 ${index + 1}`}
                            disabled={index === replacements.length - 1}
                            onClick={() => moveReplacement(index, 1)}
                          >
                            <ArrowDown size={15} strokeWidth={1.75} aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`移除替换 ${index + 1}`}
                            onClick={() =>
                              setReplacements((old) =>
                                old.filter((entry) => entry.key !== item.key),
                              )
                            }
                          >
                            <X size={15} strokeWidth={1.75} aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          label="正则表达式 (RE2)"
                          value={item.pattern}
                          maxLength={1024}
                          onChange={(event) =>
                            updateReplacement(item.key, { pattern: event.target.value })
                          }
                        />
                        <Input
                          label="替换为"
                          value={item.replacement}
                          maxLength={4096}
                          onChange={(event) =>
                            updateReplacement(item.key, { replacement: event.target.value })
                          }
                        />
                        <Input
                          label="条件参数（留空始终执行）"
                          placeholder="support-x25519mlkem768"
                          value={item.parameter}
                          maxLength={64}
                          onChange={(event) =>
                            updateReplacement(item.key, { parameter: event.target.value })
                          }
                        />
                        <Input
                          label="参数等于"
                          placeholder="true"
                          value={item.value}
                          maxLength={256}
                          disabled={!item.parameter}
                          onChange={(event) =>
                            updateReplacement(item.key, { value: event.target.value })
                          }
                        />
                      </div>
                    </section>
                  ))}
                </div>
              )}

              {stage === 'script' && (
                <div className="space-y-3">
                  <Textarea
                    label="配置处理脚本"
                    rows={22}
                    maxLength={16384}
                    value={script}
                    spellCheck={false}
                    className="font-mono text-(length:--text-sm)"
                    aria-describedby={`${form}-script-hint`}
                    onChange={(event) => setScript(event.target.value)}
                    placeholder={
                      'if (context.params["support-x25519mlkem768"] === "true") {\n  config = config.replace(/(fp=|tls-profile=)chrome(?=,|$)/gm, "$1chrome147");\n}\nreturn config;'
                    }
                  />
                  <div
                    id={`${form}-script-hint`}
                    className="space-y-1 text-(length:--text-xs) text-text-secondary [overflow-wrap:anywhere]"
                  >
                    <p>
                      <span className="font-mono text-foreground">config</span>{' '}
                      为替换后的配置字符串，必须返回字符串；留空则跳过。
                    </p>
                    <p>
                      可读取 <span className="font-mono text-foreground">context.userAgent</span> 与{' '}
                      <span className="font-mono text-foreground">context.params</span>，执行上限
                      100 毫秒，不提供网络、文件或系统命令接口。
                    </p>
                  </div>
                </div>
              )}
            </fieldset>
          </form>

          {/* Right Pane: Live Preview Sandbox */}
          <aside
            aria-label="模板输出预览"
            className="min-w-0 space-y-4 rounded-(--radius-panel) border-[1px] border-border bg-surface p-5 xl:col-span-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-(length:--text-sm) font-medium">脱敏输出预览</h3>
                <p className="mt-0.5 text-(length:--text-xs) text-text-secondary">
                  使用示例节点运行当前草稿与语法校验。
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                loading={previewing}
                onClick={() => void renderPreview()}
              >
                <Eye size={15} strokeWidth={1.75} aria-hidden="true" />
                {previewStale ? '重新生成' : '生成预览'}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="模拟 User-Agent"
                value={userAgent}
                maxLength={1024}
                disabled={busy}
                onChange={(event) => setUserAgent(event.target.value)}
                placeholder="例如：Loon/3.3"
              />
              <Input
                label="模拟链接参数"
                value={query}
                maxLength={8192}
                disabled={busy}
                placeholder="support-x25519mlkem768=true"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {previewStale ? (
                  <Badge tone="warning" size="sm">
                    内容已修改，需重新生成
                  </Badge>
                ) : (
                  <span className="text-(length:--text-xs) text-text-secondary">
                    {preview !== null ? '已生成脱敏示例配置' : '点击右上角生成完整配置预览'}
                  </span>
                )}
                {preview && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void copyPreview()}
                  >
                    <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
                    复制预览
                  </Button>
                )}
              </div>
              <Textarea
                label="预览内容"
                rows={22}
                readOnly
                spellCheck={false}
                value={preview ?? ''}
                placeholder="生成后显示完整配置"
                className="font-mono text-(length:--text-xs)"
              />
            </div>
          </aside>
        </div>
      </EditorWorkspace>

      {confirming && (
        <TemplateReviewDialog
          source={source}
          draft={buildEdit(true)}
          userAgent={userAgent}
          query={query}
          session={session}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void save(true)}
        />
      )}

      {existing && (
        <TemplateHistoryDrawer
          source={historyOpen ? source : null}
          session={session}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => {
            setHistoryOpen(false);
            onRestored();
          }}
        />
      )}
    </>
  );
}
