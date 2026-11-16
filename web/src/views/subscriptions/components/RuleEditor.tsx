import { useId, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  type SubscriptionCondition,
  type SubscriptionFormat,
  type SubscriptionRule,
  saveSubscriptionRule,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { Switch } from '@/components/arc/switch/switch';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useDialogFocus } from './useDialogFocus';

type EditableCondition = SubscriptionCondition & { key: string };

export default function RuleEditor({
  rule,
  session,
  onClose,
  onSaved,
}: {
  rule: SubscriptionRule | null;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useId();
  const { toast } = useToastStack();
  const dialogFocus = useDialogFocus();
  const confirmationFocus = useDialogFocus();
  const [name, setName] = useState(rule?.name ?? '');
  const [format, setFormat] = useState<SubscriptionFormat>(rule?.format ?? 'mihomo');
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
          format,
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        {...dialogFocus}
        title={rule ? '编辑应用规则' : '添加应用规则'}
        className="sm:min-w-[min(680px,calc(100vw-32px))]"
        footer={
          <Button form={form} type="submit" loading={busy}>
            保存规则
          </Button>
        }
      >
        <form
          id={form}
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(false);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="规则名称"
              value={name}
              maxLength={128}
              required
              onChange={(event) => setName(event.target.value)}
            />
            <Select
              label="配置格式"
              value={format}
              onValueChange={(value) => setFormat(value as SubscriptionFormat)}
              options={[
                { value: 'mihomo', label: 'Mihomo YAML' },
                { value: 'sing-box', label: 'sing-box JSON' },
                { value: 'loon', label: 'Loon 配置' },
              ]}
            />
            <Input
              label="匹配顺序（数字越小越优先）"
              type="number"
              min={0}
              max={10000}
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
            <div className="flex items-end">
              <Switch label="启用规则" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
          <section aria-labelledby={`${form}-conditions`} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`${form}-conditions`} className="text-sm font-medium">
                User-Agent 条件
              </h2>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={conditions.length >= 32}
                onClick={() =>
                  setConditions((old) => [
                    ...old,
                    { key: crypto.randomUUID(), kind: 'contains', pattern: '' },
                  ])
                }
              >
                添加条件
              </Button>
            </div>
            {conditions.map((condition, index) => (
              <div
                key={condition.key}
                className="grid items-end gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]"
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
                  maxLength={256}
                  value={condition.pattern}
                  onChange={(event) => update(condition.key, { pattern: event.target.value })}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setConditions((old) => old.filter((value) => value.key !== condition.key))
                  }
                >
                  移除条件
                </Button>
              </div>
            ))}
          </section>
        </form>
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent
            {...confirmationFocus}
            title="保存共享应用规则？"
            description={`更改将在 ${rule?.references ?? 0} 个订阅下次更新时生效。`}
            footer={
              <Button loading={busy} onClick={() => void submit(true)}>
                确认保存规则
              </Button>
            }
          />
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
