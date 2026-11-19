import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpRight,
  ArrowUpToLine,
  Ban,
  ChevronDown,
  ChevronUp,
  Copy,
  Forward,
  Pencil,
  Trash2,
} from 'lucide-react';
import { type MouseEvent, useId, useState } from 'react';
import type { RouteRule } from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Switch } from '@/components/arc/switch/switch';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import type { RouteOutletOption } from './RoutingRuleEditor';
import { routeMatchConditions } from './routing-rule-conditions';

export default function RoutingRuleRow({
  rule,
  ordering,
  index,
  count,
  outlet,
  services,
  disabled,
  canEditExit,
  onMove,
  onToggle,
  onEdit,
  onCopy,
  onDelete,
}: {
  rule: RouteRule;
  ordering: boolean;
  index: number;
  count: number;
  outlet: RouteOutletOption | undefined;
  services: string[];
  disabled: boolean;
  canEditExit: boolean;
  onMove: (index: number) => void;
  onToggle: (enabled: boolean) => void;
  onEdit: (event: MouseEvent<HTMLButtonElement>) => void;
  onCopy: () => void;
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const fields = routeMatchConditions(rule).flatMap((group) => group.conditions);
  const [first] = fields;
  const summary = rule.match_all
    ? '匹配全部流量'
    : first
      ? [
          `${first.label} ${first.values.slice(0, 2).join('、')}${first.values.length > 2 ? ` 等 ${first.values.length} 项` : ''}`,
          ...(fields.length > 1 ? [`另有 ${fields.length - 1} 个条件`] : []),
        ].join('，')
      : '无匹配条件';
  const scope =
    services.length === 0
      ? '全部服务'
      : services.length === 1
        ? services[0]
        : `${services.length} 个服务`;
  const OutletIcon =
    rule.outbound === 'reject' ? Ban : rule.outbound === 'direct' ? ArrowUpRight : Forward;

  const moves = [
    { id: 'first', label: '移到首位', icon: ArrowUpToLine, target: 0 },
    { id: 'up', label: '上移', icon: ArrowUp, target: index - 1 },
    { id: 'down', label: '下移', icon: ArrowDown, target: index + 1 },
    { id: 'last', label: '移到末位', icon: ArrowDownToLine, target: count - 1 },
  ];

  function moveTo(next: number, event: MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget;
    const restoreFocus = event.detail === 0 || document.activeElement === button;
    onMove(next);
    requestAnimationFrame(() => {
      if (!button.isConnected) return;
      const group = button.parentElement;
      group?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (!restoreFocus) return;
      const reverse = next > index ? 'up' : 'down';
      const target = button.disabled
        ? group?.querySelector<HTMLButtonElement>(`button[data-reorder="${reverse}"]:enabled`)
        : button;
      target?.focus({ preventScroll: true });
    });
  }

  return (
    <li className="min-w-0 py-3">
      <div className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 @min-[40rem]:grid-cols-[2rem_minmax(0,1fr)_minmax(6rem,10rem)_auto]">
        <span className="self-start pt-0.5 text-center font-mono text-(length:--text-xs) text-text-secondary tabular-nums">
          <span className="sr-only">优先级 </span>
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="col-span-2 min-w-0 space-y-1 @min-[40rem]:col-span-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h4 className="min-w-0 wrap-anywhere text-(length:--text-sm) font-medium text-foreground">
              {rule.name}
            </h4>
            <span
              className="max-w-full truncate text-(length:--text-xs) text-text-secondary"
              title={scope}
            >
              {scope}
            </span>
            {!rule.enabled && (
              <span className="text-(length:--text-xs) text-text-secondary">已停用</span>
            )}
          </div>
          <p className="truncate text-(length:--text-xs) text-text-secondary">{summary}</p>
        </div>
        <div
          className={`${ordering ? 'col-span-2 @min-[40rem]:col-span-1' : ''} col-start-2 flex min-w-0 items-center gap-2 text-(length:--text-xs) text-foreground @min-[40rem]:col-start-auto`}
        >
          <OutletIcon size={15} aria-hidden="true" className="shrink-0 text-text-secondary" />
          <span className="wrap-anywhere">
            <span className="sr-only">目标出口 </span>
            {outlet?.label ?? '出口不可用'}
          </span>
        </div>
        {ordering ? (
          <div
            role="group"
            aria-label={`${rule.name} 的排序`}
            className="col-span-2 col-start-2 flex scroll-mt-32 scroll-mb-24 flex-wrap items-center gap-2 @min-[40rem]:col-span-1 @min-[40rem]:col-start-auto"
          >
            {moves.map(({ id, label, icon: Icon, target }) => (
              <Tooltip key={id} content={label}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled || target === index || target < 0 || target >= count}
                  aria-label={`${label} ${rule.name}`}
                  data-reorder={id}
                  onClick={(event) => moveTo(target, event)}
                >
                  <Icon size={16} aria-hidden="true" />
                </Button>
              </Tooltip>
            ))}
          </div>
        ) : (
          <div role="group" aria-label={`${rule.name} 的操作`} className="flex items-center gap-3">
            <Switch
              checked={rule.enabled}
              disabled={disabled}
              aria-label={`启用规则 ${rule.name}`}
              onCheckedChange={onToggle}
            />
            <Tooltip content={expanded ? '收起规则详情' : '展开规则详情'}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${expanded ? '收起' : '展开'} ${rule.name} 的详情`}
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronUp size={16} aria-hidden="true" />
                ) : (
                  <ChevronDown size={16} aria-hidden="true" />
                )}
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
      <div
        id={detailsId}
        hidden={!expanded || ordering}
        className="mt-3 ml-11 space-y-3 border-t-[1px] border-border pt-3"
      >
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-(length:--text-xs)">
          <dt className="text-text-secondary">适用服务</dt>
          <dd className="wrap-anywhere">{services.length ? services.join('、') : '全部服务'}</dd>
          {rule.match_all ? (
            <>
              <dt className="text-text-secondary">匹配范围</dt>
              <dd>全部流量</dd>
            </>
          ) : (
            fields.map(({ label, values }) => (
              <div key={label} className="contents">
                <dt className="text-text-secondary">{label}</dt>
                <dd className="wrap-anywhere">{values.join('、')}</dd>
              </div>
            ))
          )}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!canEditExit}
            aria-label={`编辑 ${rule.name}`}
            onClick={onEdit}
          >
            <Pencil size={14} aria-hidden="true" />
            编辑规则
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || count >= 128}
            aria-label={`复制 ${rule.name}`}
            onClick={onCopy}
          >
            <Copy size={14} aria-hidden="true" />
            复制
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`删除 ${rule.name}`}
            onClick={onDelete}
          >
            <Trash2 size={14} aria-hidden="true" />
            删除
          </Button>
        </div>
      </div>
    </li>
  );
}
