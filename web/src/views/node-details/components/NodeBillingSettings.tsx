import { billingPeriods, type NodeBilling } from '@/api/node-billing';
import { Button } from '@/components/arc/button/button';
import { DatePicker } from '@/components/arc/date-picker/date-picker';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { localDate } from '@/utils/node-assets';
import type { BillingDraft } from './node-billing-draft';

const currencies = [
  { value: 'USD', label: 'USD（美元 $）' },
  { value: 'CNY', label: 'CNY（人民币￥）' },
  { value: 'EUR', label: 'EUR（欧元€）' },
  { value: 'JPY', label: 'JPY（日元¥）' },
] satisfies { value: NonNullable<NodeBilling['currency']>; label: string }[];
const periods = Object.entries(billingPeriods).map(([value, label]) => ({ value, label }));

export default function NodeBillingSettings({
  form,
  setDraft,
  pending,
}: {
  form: BillingDraft;
  setDraft: (draft: BillingDraft) => void;
  pending: boolean;
}) {
  const { fee, expiry } = form;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const updateFee = (key: keyof BillingDraft['fee'], value: string) =>
    setDraft({ ...form, fee: { ...fee, [key]: value } });

  return (
    <section aria-labelledby="billing-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="billing-heading" className="text-(length:--text-base) font-medium text-foreground">
          费用与续期
        </h2>
        <span className="text-(length:--text-xs) text-text-secondary">需点击底部保存生效</span>
      </div>

      <div className="divide-y-[1px] divide-border rounded-(--radius-surface) border-[1px] border-border bg-surface">
        <div className="p-4 sm:px-5">
          <div className="grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="col-span-2 sm:col-span-1">
              <Input
                label="每期总价"
                inputMode="decimal"
                value={fee.price}
                placeholder="未设置"
                maxLength={22}
                disabled={pending}
                onChange={(e) => updateFee('price', e.target.value)}
              />
            </div>
            <Select
              label="货币"
              placeholder="未设置"
              options={currencies}
              value={fee.price ? fee.currency : ''}
              disabled={pending || !fee.price}
              onValueChange={(value) => updateFee('currency', value)}
            />
            <Select
              label="计费周期"
              placeholder="未设置"
              options={periods}
              value={fee.price ? fee.period : ''}
              disabled={pending || !fee.price}
              onValueChange={(value) => updateFee('period', value)}
            />
          </div>
        </div>

        <div className="space-y-2 p-4 sm:px-5">
          <div className="flex max-w-md flex-wrap items-end gap-2">
            <DatePicker
              label="到期日期"
              placeholder="永不过期"
              className="min-w-[200px] flex-1"
              locale="zh-CN"
              disabled={pending}
              value={expiry ? new Date(`${expiry}T12:00`) : undefined}
              onChange={(day) => setDraft({ ...form, expiry: day ? localDate(day) : '' })}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !expiry}
              onClick={() => setDraft({ ...form, expiry: '' })}
            >
              清空日期
            </Button>
          </div>
          <p className="text-(length:--text-xs) text-text-secondary">
            留空即永不过期。指定日期按 {timeZone} 时区于当天 23:59:59 到期。
          </p>
        </div>
      </div>
    </section>
  );
}
