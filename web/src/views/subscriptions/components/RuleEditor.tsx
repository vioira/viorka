import { Plus, Save, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  type SubscriptionCondition,
  type SubscriptionRule,
  type SubscriptionTemplate,
  saveSubscriptionRule,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { Switch } from '@/components/arc/switch/switch';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EditorWorkspace from './EditorWorkspace';
import { useDialogFocus } from './useDialogFocus';

type EditableCondition = SubscriptionCondition & { key: string };

export default function RuleEditor({
  rule,
  templates,
  session,
  onClose,
  onSaved,
}: {
  rule: SubscriptionRule | null;
  templates: SubscriptionTemplate[];
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useId();
  const { toast } = useToastStack();
  const confirmationFocus = useDialogFocus();
  const [name, setName] = useState(rule?.name ?? '');
  const [templateId, setTemplateId] = useState(
    rule?.template_id ??
      templates.find((template) => template.id === 'mihomo')?.id ??
      templates[0]?.id ??
      '',
  );
  const [position, setPosition] = useState(String(rule?.position ?? 100));
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [conditions, setConditions] = useState<EditableCondition[]>(() =>
    (rule?.conditions ?? [{ kind: 'contains', pattern: '' }]).map((value, index) => ({
      ...value,
      key: `initial-${index}`,
    })),
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  function update(key: string, value: Partial<EditableCondition>) {
    setConditions((old) =>
      old.map((condition) => (condition.key === key ? { ...condition, ...value } : condition)),
    );
  }
  async function submit(confirm: boolean) {
    if (busy) return;
    const number = Number(position);
    const values = conditions.map(({ kind, pattern }) => ({ kind, pattern: pattern.trim() }));
    if (
      !name.trim() ||
      !templateId ||
      !Number.isInteger(number) ||
      number < 0 ||
      number > 10000 ||
      values.some((value) => !value.pattern) ||
      (enabled && !values.length)
    ) {
      toast({
        id: 'subscription-rule-validation',
        type: 'error',
        title: '请完善应用规则',
        description: '填写名称、顺序和匹配条件。',
      });
      return;
    }
    if (rule && rule.references > 1 && !confirm) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await saveSubscriptionRule(
        rule,
        {
          name: name.trim(),
          template_id: templateId,
          position: number,
          enabled,
          conditions: values,
          version: rule?.version ?? 0,
          expected_references: rule?.references ?? 0,
          confirm,
        },
        session,
      );
      toast({ type: 'success', title: '应用规则已保存' });
      onSaved();
    } catch (error) {
      toast({
        id: 'subscription-rule-save',
        type: 'error',
        title: '未能保存应用规则',
        description: error instanceof Error ? error.message : '请检查匹配条件后重试。',
      });
    } finally {
      setBusy(false);
    }
  }
  const initialTemplate =
    rule?.template_id ??
    templates.find((template) => template.id === 'mihomo')?.id ??
    templates[0]?.id ??
    '';
  const dirty =
    name !== (rule?.name ?? '') ||
    templateId !== initialTemplate ||
    position !== String(rule?.position ?? 100) ||
    enabled !== (rule?.enabled ?? true) ||
    JSON.stringify(conditions.map(({ key: _, ...value }) => value)) !==
      JSON.stringify(rule?.conditions ?? [{ kind: 'contains', pattern: '' }]);
  const selectedTemplate = templates.find((template) => template.id === templateId);
  return (
    <>
      <EditorWorkspace
        title={rule ? `编辑规则：${rule.name}` : '添加应用规则'}
        form={form}
        saveLabel="保存规则"
        busy={busy}
        dirty={dirty}
        onClose={onClose}
      >
        <form
          id={form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit(false);
          }}
        >
          <fieldset
            disabled={busy}
            className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.5fr)]"
          >
            <div className="min-w-0 space-y-8">
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_160px]">
                <Input
                  label="规则名称"
                  value={name}
                  maxLength={128}
                  required
                  placeholder="例如：Loon 客户端"
                  onChange={(event) => setName(event.target.value)}
                />
                <Input
                  label="优先级（小值优先）"
                  type="number"
                  min={0}
                  max={10000}
                  value={position}
                  onChange={(event) => setPosition(event.target.value)}
                />
              </div>
              <section aria-labelledby={`${form}-conditions`} className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 id={`${form}-conditions`} className="text-base font-medium">
                      匹配客户端
                    </h3>
                    <p className="mt-1 text-sm text-(--text-secondary)">
                      任一条件匹配 User-Agent 即命中，忽略大小写。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={conditions.length >= 32}
                    onClick={() =>
                      setConditions((old) => [
                        ...old,
                        { key: crypto.randomUUID(), kind: 'contains', pattern: '' },
                      ])
                    }
                  >
                    <Plus size={16} aria-hidden="true" />
                    添加条件
                  </Button>
                </div>
                {conditions.map((condition, index) => (
                  <div
                    key={condition.key}
                    className="grid items-end gap-3 border-b border-(--border-subtle) pb-5 sm:grid-cols-[160px_minmax(0,1fr)_auto]"
                  >
                    <Select
                      label={`条件 ${index + 1} 类型`}
                      value={condition.kind}
                      onValueChange={(value) =>
                        update(condition.key, { kind: value as SubscriptionCondition['kind'] })
                      }
                      options={[
                        { value: 'contains', label: '包含关键词' },
                        { value: 'regex', label: '正则表达式' },
                      ]}
                    />
                    <Input
                      label={`条件 ${index + 1} 内容`}
                      value={condition.pattern}
                      maxLength={256}
                      placeholder={
                        condition.kind === 'regex' ? '例如：Loon/[0-9]+' : '例如：clash-verge'
                      }
                      onChange={(event) => update(condition.key, { pattern: event.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`移除条件 ${index + 1}`}
                      onClick={() =>
                        setConditions((old) => old.filter((value) => value.key !== condition.key))
                      }
                    >
                      <X size={16} aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                {!conditions.length && (
                  <p className="py-6 text-sm text-(--text-secondary)">
                    启用规则前至少添加一个匹配条件。
                  </p>
                )}
              </section>
            </div>
            <aside className="min-w-0 space-y-6 border-t border-(--border-subtle) pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
              <Select
                label="输出配置模板"
                value={templateId}
                onValueChange={setTemplateId}
                options={templates.map((template) => ({
                  value: template.id,
                  label: template.name,
                }))}
              />
              {selectedTemplate && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
                  <dt className="text-(--text-secondary)">配置格式</dt>
                  <dd>{selectedTemplate.format}</dd>
                  <dt className="text-(--text-secondary)">正则替换</dt>
                  <dd>{selectedTemplate.replacements.length} 条</dd>
                  <dt className="text-(--text-secondary)">脚本</dt>
                  <dd>{selectedTemplate.script ? '已配置 JavaScript' : '未配置'}</dd>
                </dl>
              )}
              <div className="border-t border-(--border-subtle) pt-5">
                <Switch label="启用规则" checked={enabled} onCheckedChange={setEnabled} />
                <p className="mt-2 text-xs text-(--text-secondary)">
                  停用后，订阅不会使用此规则识别客户端。
                </p>
              </div>
              {rule && (
                <p className="text-xs text-(--text-secondary)">
                  {rule.references} 个订阅引用此规则。
                </p>
              )}
            </aside>
          </fieldset>
        </form>
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
          title="保存共享应用规则？"
          description={`更改将在 ${rule?.references ?? 0} 个订阅下次更新时生效。`}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                继续编辑
              </Button>
              <Button loading={busy} onClick={() => void submit(true)}>
                <Save size={16} aria-hidden="true" />
                确认保存规则
              </Button>
            </>
          }
        />
      </Dialog>
    </>
  );
}
