import { billingPeriods, type NodeBilling } from '@/api/node-billing';
import { nodeExpiry } from '@/utils/node-assets';

const symbols = { CNY: '¥', USD: '$', EUR: '€', JPY: 'JP¥' };

function feeAmounts(billing: NodeBilling) {
  const { price, currency, period_months: months } = billing;
  if (price === undefined || !currency || !months) return;
  const symbol = symbols[currency];
  const digits = currency === 'JPY' ? 0 : 2;
  const [whole, fraction = ''] = price.split('.');
  const minor = BigInt(whole + fraction.padEnd(digits, '0'));
  // Divide the original price for each estimate, rounding only the final minor unit.
  function amount(divisor: number) {
    const rounded = (minor + BigInt(Math.floor(divisor / 2))) / BigInt(divisor);
    const scale = 10n ** BigInt(digits);
    const major = (rounded / scale).toLocaleString('zh-CN');
    const decimal = digits ? `.${String(rounded % scale).padStart(digits, '0')}` : '';
    return `${symbol}${major}${decimal}`;
  }
  return { total: amount(1), monthly: amount(months), daily: amount(months * 30), months };
}

export default function OverviewBilling({ billing, now }: { billing?: NodeBilling; now: number }) {
  const fee = billing && feeAmounts(billing);
  const empty = billing ? '免费' : '尚未读取';
  const columns = [
    {
      label: '每期资费',
      value: fee?.total ?? empty,
      unit: fee && billingPeriods[fee.months],
      detail: fee && `每 ${fee.months} 个月结算一次`,
    },
    {
      label: '折合月付成本',
      value: fee?.monthly ?? empty,
      unit: fee && '月',
      detail: fee && `约 ${fee.daily} / 天`,
    },
    { label: '租约到期时间', value: nodeExpiry(billing, now) },
  ];
  return (
    <section aria-label="费用与续期" className="v-card">
      <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
        {columns.map(({ label, value, unit, detail }) => (
          <div key={label} className="min-w-0">
            <dt className="text-(length:--text-sm) text-text-secondary">{label}</dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-x-1">
              <span className="wrap-anywhere text-(length:--text-lg) font-medium text-foreground tabular-nums">
                {value}
              </span>
              {unit && (
                <span className="text-(length:--text-sm) text-text-secondary">/ {unit}</span>
              )}
            </dd>
            {detail && (
              <dd className="mt-1 text-(length:--text-xs) text-text-secondary tabular-nums">
                {detail}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
