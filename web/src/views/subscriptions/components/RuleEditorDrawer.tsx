import { Plus, Save, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  type SubscriptionCondition,
  type SubscriptionRule,
  type SubscriptionTemplate,
  saveSubscriptionRule,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { Switch } from '@/components/arc/switch/switch';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useDialogFocus } from './useDialogFocus';

type EditableCondition = SubscriptionCondition & { key: string };

export default function RuleEditorDrawer({
  open,
  rule,
  templates,
  session,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: SubscriptionRule | null;
  templates: SubscriptionTemplate[];
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useId();
  const { toast } = useToastStack();
  const confirmationFocus = useDialogFocus();

  const defaultTemplateId =
    templates.find((template) => template.id === 'mihomo')?.id ?? templates[0]?.id ?? '';

  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [position, setPosition] = useState('100');
  const [enabled, setEnabled] = useState(true);
  const [conditions, setConditions] = useState<EditableCondition[]>([
    { key: 'initial-0', kind: 'contains', pattern: '' },
  ]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(rule?.name ?? '');
    setTemplateId(rule?.template_id ?? defaultTemplateId);
    setPosition(String(rule?.position ?? 100));
    setEnabled(rule?.enabled ?? true);
    setConditions(
      (rule?.conditions ?? [{ kind: 'contains', pattern: '' }]).map((value, index) => ({
        ...value,
        key: `${rule?.id ?? 'new'}-${index}`,
      })),
    );
    setConfirming(false);
  }, [open, rule, defaultTemplateId]);

  function updateCondition(key: string, value: Partial<EditableCondition>) {
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
        description: '填写名称、0 至 10000 的优先级和匹配条件。',
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
      setConfirming(false);
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

  const selectedTemplate = templates.find((template) => template.id === templateId);

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) onClose();
        }}
      >
        <DrawerContent
          data-subscription-management
          side="right"
          className="w-[min(500px,100vw)]!"
          title={rule ? `编辑规则：${rule.name}` : '添加分发规则'}
          description="按优先级从小到大依次匹配，命中的首条已启用规则决定输出模板。"
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={onClose}>
                取消
              </Button>
              <Button type="submit" form={form} loading={busy}>
                <Save size={16} strokeWidth={1.75} aria-hidden="true" />
                保存规则
              </Button>
            </div>
          }
        >
          <form
            id={form}
            onSubmit={(event) => {
              event.preventDefault();
              void submit(false);
            }}
          >
            <fieldset disabled={busy} className="min-w-0 space-y-5">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_128px]">
                <Input
                  label="规则名称"
                  value={name}
                  maxLength={128}
                  required
                  placeholder="例如：Loon 客户端"
                  onChange={(event) => setName(event.target.value)}
                />
                <Input
                  label="优先级（小优先）"
                  type="number"
                  min={0}
                  max={10000}
                  value={position}
                  onChange={(event) => setPosition(event.target.value)}
                />
              </div>

              <div className="rounded-(--radius-control) border-[1px] border-border px-3.5 py-3">
                <Switch label="启用规则" checked={enabled} onCheckedChange={setEnabled} />
                <p className="mt-1.5 text-(length:--text-xs) text-text-secondary">
                  停用后，订阅不会使用此规则识别客户端。
                </p>
              </div>

              <div className="space-y-3">
                <Select
                  label="输出配置模板"
                  value={templateId}
                  onValueChange={setTemplateId}
                  options={templates.map((template) => ({
                    value: template.id,
                    label: `${template.name} (${template.format})`,
                  }))}
                />
                {selectedTemplate && (
                  <dl className="grid grid-cols-3 gap-3 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/50 px-3.5 py-2.5 text-(length:--text-xs)">
                    <div>
                      <dt className="text-text-secondary">配置格式</dt>
                      <dd className="mt-0.5 font-mono">{selectedTemplate.format}</dd>
                    </div>
                    <div>
                      <dt className="text-text-secondary">正则替换</dt>
                      <dd className="mt-0.5 tabular-nums">
                        {selectedTemplate.replacements.length} 条
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-secondary">脚本处理</dt>
                      <dd className="mt-0.5">{selectedTemplate.script ? '已配置 JS' : '未配置'}</dd>
                    </div>
                  </dl>
                )}
              </div>

              <section aria-labelledby={`${form}-conditions`} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 id={`${form}-conditions`} className="text-(length:--text-sm) font-medium">
                      User-Agent 匹配条件
                    </h3>
                    <p className="mt-0.5 text-(length:--text-xs) text-text-secondary">
                      任一条件命中即匹配，忽略大小写。
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={conditions.length >= 32}
                    onClick={() =>
                      setConditions((old) => [
                        ...old,
                        { key: crypto.randomUUID(), kind: 'contains', pattern: '' },
                      ])
                    }
                  >
                    <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                    添加条件
                  </Button>
                </div>

                <div className="space-y-3">
                  {conditions.map((condition, index) => (
                    <div
                      key={condition.key}
                      className="grid items-end gap-2 border-b-[1px] border-border-subtle pb-3 sm:grid-cols-[132px_minmax(0,1fr)_auto]"
                    >
                      <Select
                        label={`条件 ${index + 1} 类型`}
                        value={condition.kind}
                        onValueChange={(value) =>
                          updateCondition(condition.key, {
                            kind: value as SubscriptionCondition['kind'],
                          })
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
                        onChange={(event) =>
                          updateCondition(condition.key, { pattern: event.target.value })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`移除条件 ${index + 1}`}
                        onClick={() =>
                          setConditions((old) => old.filter((value) => value.key !== condition.key))
                        }
                      >
                        <X size={15} strokeWidth={1.75} aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  {conditions.length === 0 && (
                    <p className="py-4 text-center text-(length:--text-xs) text-text-secondary">
                      启用规则前至少添加一个匹配条件。
                    </p>
                  )}
                </div>
              </section>

              {rule && (
                <p className="text-(length:--text-xs) text-text-secondary">
                  当前有 <span className="tabular-nums">{rule.references}</span> 个订阅引用此规则。
                </p>
              )}
            </fieldset>
          </form>
        </DrawerContent>
      </Drawer>

      <Dialog
        open={confirming}
        onOpenChange={(next) => {
          if (!busy) setConfirming(next);
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
                <Save size={16} strokeWidth={1.75} aria-hidden="true" />
                确认保存规则
              </Button>
            </>
          }
        />
      </Dialog>
    </>
  );
}
