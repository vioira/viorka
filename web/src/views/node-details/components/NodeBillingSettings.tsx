import { useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import {
  billingCurrencies,
  billingPeriods,
  type NodeBilling,
  saveNodeBilling,
} from '@/api/node-billing';
import { getNode } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { RadioGroup } from '@/components/arc/radio-group/radio-group';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import { localMinuteOptions } from '@/utils/node-assets';
import { type BillingDraft, editBilling, rebaseBillingDraft } from './node-billing-draft';

const fieldBorder = 'enabled:not-focus-visible:border-text-muted! focus-visible:border-accent!';
const currencies = billingCurrencies.map((value) => ({ value, label: value }));
const periods = Object.entries(billingPeriods).map(([value, label]) => ({ value, label }));

export default function NodeBillingSettings({
  id,
  billing,
  session,
  onChanged,
}: {
  id: string;
  billing: NodeBilling;
  session: Session;
  onChanged: () => Promise<void>;
}) {
  const [saved, setSaved] = useState<NodeBilling>();
  const [draft, setDraft] = useState<BillingDraft>();
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const request = useRef<AbortController | null>(null);
  const [, error] = useToastFeedback('error');
  const [, success] = useToastFeedback('success');
  const { toast } = useToastStack();
  useEffect(() => () => request.current?.abort(), []);
  const current = saved && saved.revision > billing.revision ? saved : billing;
  const form = draft ?? editBilling(current);
  const { fee, expiry } = form;
  const expiryOptions = localMinuteOptions(expiry.minute);
  const expiresAt =
    expiryOptions.length === 1
      ? expiryOptions[0].value
      : expiryOptions.find((option) => option.value === expiry.instant)?.value;
  const updateFee = (key: keyof BillingDraft['fee'], value: string) =>
    setDraft({ ...form, fee: { ...fee, [key]: value } });
  const updateExpiry = (minute: string) => {
    if (minute === expiry.minute) return;
    const original = editBilling(form.base).expiry;
    setDraft({
      ...form,
      expiry: minute === original.minute ? original : { minute, instant: undefined },
    });
  };

  async function reload() {
    if (request.current || !draft) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const node = await getNode(id, controller.signal);
      if (controller.signal.aborted) return;
      if (!node.billing) throw new Error('尚未读取费用配置。');
      setSaved(node.billing);
      setDraft(rebaseBillingDraft(draft, node.billing));
      setConflict(false);
      error('');
      toast({
        type: 'info',
        title: '已读取最新费用配置',
        description: '已保留本次编辑，请核对表单后保存。',
      });
    } catch (cause) {
      if (!controller.signal.aborted)
        error(cause instanceof Error ? cause.message : '读取费用配置失败，请重试。');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  async function save() {
    if (request.current || !draft || conflict) return;
    const { price, currency, period } = draft.fee;
    if (
      price &&
      (!billingCurrencies.includes(currency as NodeBilling['currency'] & string) ||
        !Object.hasOwn(billingPeriods, period))
    ) {
      error('填写价格时，请选择货币和计费周期。');
      return;
    }
    if (price && !(currency === 'JPY' ? /^\d{1,19}$/ : /^\d{1,19}(\.\d{1,2})?$/).test(price)) {
      error(currency === 'JPY' ? '日元价格须为非负整数。' : '请输入非负价格，最多保留两位小数。');
      return;
    }
    if (expiry.minute && !expiresAt) {
      error(
        expiryOptions.length > 1
          ? '这个本地时间出现两次，请选择到期时间的 UTC 偏移。'
          : '请输入有效的本地到期日期和时间，精确到分钟。',
      );
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const next = await saveNodeBilling(
        id,
        {
          expected_revision: draft.base.revision,
          ...(price
            ? {
                price,
                currency: currency as NodeBilling['currency'],
                period_months: Number(period) as NodeBilling['period_months'],
              }
            : {}),
          expires_at: expiresAt,
        },
        session,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSaved(next);
      setDraft(undefined);
      setConflict(false);
      error('');
      success('费用与续期已保存。');
      await onChanged();
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 409) {
        setConflict(true);
        error('费用配置已被其他管理员更新。请重新读取，表单会保留本次编辑。');
      } else error(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return (
    <section
      aria-labelledby="billing-heading"
      className="mb-6 border-b-[1px] border-border-subtle pb-6"
    >
      <h2 id="billing-heading" className="mb-4 text-(length:--text-sm) font-medium">
        费用与续期
      </h2>
      <form
        className="grid max-w-3xl gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Input
            className={fieldBorder}
            label="每期总价"
            inputMode="decimal"
            value={fee.price}
            placeholder="未设置"
            maxLength={22}
            disabled={pending}
            onChange={(e) => updateFee('price', e.target.value)}
          />
          <Select
            className={fieldBorder}
            label="货币"
            placeholder="未设置"
            options={currencies}
            value={fee.price ? fee.currency : ''}
            disabled={pending || !fee.price}
            onValueChange={(value) => updateFee('currency', value)}
          />
          <Select
            className={fieldBorder}
            label="计费周期"
            placeholder="未设置"
            options={periods}
            value={fee.price ? fee.period : ''}
            disabled={pending || !fee.price}
            onValueChange={(value) => updateFee('period', value)}
          />
        </div>
        <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:max-w-sm">
          <Input
            className={fieldBorder}
            label="到期时间（本地时间）"
            type="datetime-local"
            step={60}
            value={expiry.minute}
            description={expiry.minute ? undefined : '未设置'}
            onChange={(e) => updateExpiry(e.target.value)}
          />
          {expiryOptions.length > 1 && (
            <RadioGroup
              label="该本地时间出现两次，请选择 UTC 偏移"
              options={expiryOptions.map(({ value, offset }, i) => ({
                value,
                label: `${i === 0 ? '第一次' : '第二次'}（${offset}）`,
              }))}
              value={expiresAt ?? ''}
              onValueChange={(instant) => setDraft({ ...form, expiry: { ...expiry, instant } })}
            />
          )}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="secondary"
            loading={pending}
            disabled={pending || !draft || conflict}
          >
            保存费用与续期
          </Button>
          {conflict && (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void reload()}
            >
              重新读取费用配置
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
