import { ArrowDown, ArrowUp, Ban, Check, Copy, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { EngineService } from '@/api/engines';
import type { Outbound, RouteRule, EngineRouting as Routing } from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { Select } from '@/components/arc/select/select';
import EmptyStates from '@/components/empty-states';
import RuleEditor, { type RouteOutletOption } from './RoutingRuleEditor';

function copiedRuleName(name: string) {
  const suffix = ' 副本';
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(128 - encoder.encode(suffix).length);
  const { written } = encoder.encodeInto(name, bytes);
  return `${new TextDecoder().decode(bytes.subarray(0, written)).trimEnd()}${suffix}`;
}

export default function EngineRouting({
  routing,
  services,
  catalogById,
  catalogLoaded,
  loading,
  disabled,
  onRefresh,
  onChange,
}: {
  routing: Routing;
  services: EngineService[];
  catalogById: ReadonlyMap<string, Outbound>;
  catalogLoaded: boolean;
  loading: boolean;
  disabled: boolean;
  onRefresh: () => Promise<void>;
  onChange: (routing: Routing) => void;
}) {
  const addTrigger = useRef<HTMLButtonElement>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const [editing, setEditing] = useState<RouteRule | null>(null);
  const [orderNotice, setOrderNotice] = useState('');
  const { rules, outbound_ids: outboundIds } = routing;
  const needsCatalog = outboundIds.length > 0 && !catalogLoaded;
  const canEditExit = !disabled && !needsCatalog;
  const options: RouteOutletOption[] = [
    { value: 'direct', label: '本机直连' },
    { value: 'reject', label: '拒绝连接' },
    ...outboundIds.map((id) => {
      const outbound = catalogById.get(id);
      return {
        value: id,
        label:
          outbound?.config.name ?? (catalogLoaded ? `配置不可用（${id}）` : '出口信息尚未读取'),
        http: outbound?.config.type === 'http',
        disabled: !outbound,
      };
    }),
  ];
  const patch = (changes: Partial<Routing>) => onChange({ ...routing, ...changes });

  function edit(rule: RouteRule, trigger: HTMLButtonElement) {
    editorTrigger.current = trigger;
    setEditing(rule);
  }

  function move(index: number, offset: number) {
    const ordered = [...rules];
    const next = index + offset;
    const rule = ordered[index];
    [ordered[index], ordered[next]] = [ordered[next], rule];
    patch({ rules: ordered });
    setOrderNotice(`${rule.name} 已移到第 ${next + 1} 条`);
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <section
          aria-label="分流设置"
          className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="shrink-0 font-medium text-foreground">
              默认出口
            </span>
            <div className="w-52">
              <Select
                label="默认出口"
                hideLabel
                value={routing.final}
                options={options.map(({ http, ...option }) => ({
                  ...option,
                  label: http ? `${option.label}（仅用于 TCP 规则）` : option.label,
                  disabled: option.disabled || http,
                }))}
                disabled={!canEditExit}
                onValueChange={(final) => patch({ final })}
              />
            </div>
          </div>
          <Checkbox
            label="域名嗅探"
            checked={routing.sniff}
            disabled={disabled}
            onCheckedChange={(checked) => patch({ sniff: checked === true })}
          />
          {needsCatalog && !loading && (
            <Button variant="ghost" onClick={onRefresh}>
              <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
              刷新出口列表
            </Button>
          )}
        </section>
        <Button
          ref={addTrigger}
          variant="secondary"
          className="ml-auto"
          disabled={!canEditExit || rules.length >= 128}
          onClick={(event) =>
            edit(
              {
                id: crypto.randomUUID(),
                name: '',
                enabled: true,
                outbound: 'direct',
                match_all: false,
              },
              event.currentTarget,
            )
          }
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          添加规则
        </Button>
      </div>

      {rules.length > 0 ? (
        <div>
          <p className="border-b-[1px] border-border pb-2 text-(length:--text-xs) text-text-secondary">
            按顺序匹配，首条命中生效
          </p>
          <ol
            className="list-decimal divide-y-[1px] divide-border pl-8"
            aria-label="分流规则匹配顺序"
          >
            {rules.map((rule, index) => {
              const outlet = options.find((option) => option.value === rule.outbound);
              return (
                <li key={rule.id} className="py-3 marker:text-text-secondary marker:tabular-nums">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 @min-[35rem]:grid-cols-[minmax(0,1fr)_minmax(7rem,0.55fr)_auto]">
                    <div className="col-span-2 min-w-0 space-y-1 wrap-anywhere @min-[35rem]:col-span-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-medium text-foreground">{rule.name}</span>
                        {!rule.enabled && <span className="text-(length:--text-xs)">已停用</span>}
                      </div>
                      <p className="text-(length:--text-xs) text-text-secondary">
                        {ruleSummary(rule, services)}
                      </p>
                    </div>
                    <div className="min-w-0 space-y-1 wrap-anywhere">
                      <span className="text-(length:--text-xs) text-text-secondary">出口</span>
                      <p className="text-(length:--text-sm) text-foreground">
                        {outlet?.label ?? '出口不可用'}
                      </p>
                    </div>
                    <div
                      className="flex flex-wrap items-center justify-end gap-2"
                      role="group"
                      aria-label={`${rule.name} 的操作`}
                    >
                      <Button
                        variant="ghost"
                        disabled={!canEditExit}
                        aria-label={`编辑 ${rule.name}`}
                        onClick={(event) => edit(rule, event.currentTarget)}
                      >
                        编辑
                      </Button>
                      <DropdownMenu
                        label="更多"
                        items={[
                          {
                            label: '上移规则',
                            icon: <ArrowUp size={16} aria-hidden="true" />,
                            disabled: disabled || index === 0,
                            onSelect: () => move(index, -1),
                          },
                          {
                            label: '下移规则',
                            icon: <ArrowDown size={16} aria-hidden="true" />,
                            disabled: disabled || index === rules.length - 1,
                            onSelect: () => move(index, 1),
                          },
                          {
                            label: '复制规则',
                            icon: <Copy size={16} aria-hidden="true" />,
                            disabled: disabled || rules.length >= 128,
                            onSelect: () =>
                              patch({
                                rules: [
                                  ...rules,
                                  {
                                    ...rule,
                                    id: crypto.randomUUID(),
                                    name: copiedRuleName(rule.name),
                                  },
                                ],
                              }),
                          },
                          {
                            label: rule.enabled ? '停用规则' : '启用规则',
                            icon: rule.enabled ? (
                              <Ban size={16} aria-hidden="true" />
                            ) : (
                              <Check size={16} aria-hidden="true" />
                            ),
                            disabled,
                            onSelect: () =>
                              patch({
                                rules: rules.map((item) =>
                                  item.id === rule.id ? { ...item, enabled: !item.enabled } : item,
                                ),
                              }),
                          },
                          {
                            label: '删除规则',
                            icon: <Trash2 size={16} aria-hidden="true" />,
                            disabled,
                            destructive: true,
                            separatorBefore: true,
                            onSelect: () => {
                              patch({ rules: rules.filter((item) => item.id !== rule.id) });
                              requestAnimationFrame(() => addTrigger.current?.focus());
                            },
                          },
                        ]}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <span className="sr-only" role="status">
            {orderNotice}
          </span>
        </div>
      ) : (
        <EmptyStates title="尚无分流规则" variant="unconfigured" headingLevel={3} />
      )}
      {editing && (
        <RuleEditor
          key={editing.id}
          rule={editing}
          editing={rules.some((rule) => rule.id === editing.id)}
          services={services.filter((service) => !service.pending_delete)}
          options={options}
          disabled={!canEditExit}
          returnFocus={() => editorTrigger.current?.focus()}
          onClose={() => setEditing(null)}
          onSave={(rule) => {
            patch({
              rules: rules.some((item) => item.id === rule.id)
                ? rules.map((item) => (item.id === rule.id ? rule : item))
                : [...rules, rule],
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ruleSummary(rule: RouteRule, services: EngineService[]) {
  const conditions = [
    rule.domain?.length ? `域名 ${rule.domain.join('、')}` : '',
    rule.domain_suffix?.length ? `后缀 ${rule.domain_suffix.join('、')}` : '',
    rule.ip_cidr?.length ? `CIDR ${rule.ip_cidr.join('、')}` : '',
    rule.port?.length ? `端口 ${rule.port.join('、')}` : '',
    rule.port_range?.length ? `端口范围 ${rule.port_range.join('、')}` : '',
    rule.network?.length ? rule.network.map((network) => network.toUpperCase()).join('、') : '',
  ];
  return [
    rule.inbound?.length
      ? rule.inbound
          .map((id) => services.find((service) => service.id === id)?.name ?? id)
          .join('、')
      : '全部服务',
    ...(rule.match_all ? ['全部流量'] : conditions),
  ]
    .filter(Boolean)
    .join('，');
}
