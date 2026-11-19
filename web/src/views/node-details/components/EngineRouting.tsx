import { Check, ListOrdered, Plus, RefreshCw } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { EngineService } from '@/api/engines';
import type { Outbound, RouteRule, EngineRouting as Routing } from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { Select } from '@/components/arc/select/select';
import { Switch } from '@/components/arc/switch/switch';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import RuleEditor, { type RouteOutletOption } from './RoutingRuleEditor';
import RoutingRuleRow from './RoutingRuleRow';

const ruleTemplates = [
  {
    label: '导入大陆直连',
    rules: [
      { id: 'preset-cn-site', name: '中国大陆站点直连', outbound: 'direct', geosite: ['cn'] },
      { id: 'preset-cn-ip', name: '中国大陆 IP 直连', outbound: 'direct', geoip: ['cn'] },
    ],
  },
  {
    label: '导入广告拦截',
    rules: [
      { id: 'preset-ads', name: '广告域名拦截', outbound: 'reject', geosite: ['category-ads-all'] },
    ],
  },
] satisfies {
  label: string;
  rules: Pick<RouteRule, 'id' | 'name' | 'outbound' | 'geosite' | 'geoip'>[];
}[];

const policyRow =
  'grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] items-start gap-x-3 py-2 @min-[32rem]:grid-cols-[8rem_minmax(0,1fr)] @min-[32rem]:gap-x-4';
const policyLabel = 'flex min-h-(--control-height-md) items-center text-text-secondary';

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
  const policyId = useId();
  const addTrigger = useRef<HTMLButtonElement>(null);
  const rulesHeading = useRef<HTMLHeadingElement>(null);
  const overlayTrigger = useRef<HTMLButtonElement | null>(null);
  const [editing, setEditing] = useState<RouteRule | null>(null);
  const [deleting, setDeleting] = useState<RouteRule | null>(null);
  const [sortMode, setSortMode] = useState(false);
  const [notice, setNotice] = useState('');
  const { toast } = useToastStack();
  const { rules, outbound_ids: outboundIds } = routing;
  const ordering = sortMode && !disabled && rules.length > 1;
  const needsCatalog = outboundIds.length > 0 && !catalogLoaded;
  const canEditExit = !disabled && !needsCatalog;
  const serviceNames = new Map(services.map(({ id, name }) => [id, name]));
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
    overlayTrigger.current = trigger;
    setEditing(rule);
  }

  function move(index: number, next: number) {
    if (disabled || next === index || next < 0 || next >= rules.length) return;
    const ordered = [...rules];
    const [rule] = ordered.splice(index, 1);
    ordered.splice(next, 0, rule);
    patch({ rules: ordered });
    setNotice(`${rule.name} 已移到第 ${next + 1} 条`);
  }

  function returnFocus() {
    if (overlayTrigger.current?.isConnected && !overlayTrigger.current.disabled)
      overlayTrigger.current.focus();
    else if (addTrigger.current && !addTrigger.current.disabled) addTrigger.current.focus();
    else rulesHeading.current?.focus();
  }

  return (
    <div className="min-w-0 space-y-6">
      <section className="space-y-3" aria-label="分流规则列表">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h3
              ref={rulesHeading}
              tabIndex={-1}
              className="text-(length:--text-sm) font-medium text-foreground"
            >
              分流规则
            </h3>
            <p className="text-(length:--text-xs) text-text-secondary">
              {ordering
                ? '移动规则可调整匹配优先级，更改将写入草稿。'
                : '从上到下匹配，首条命中的规则决定出口。'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rules.length > 1 && (
              <Button
                variant={ordering ? 'secondary' : 'ghost'}
                disabled={disabled}
                aria-label={ordering ? '完成排序' : '调整顺序'}
                aria-pressed={ordering}
                onClick={() => setSortMode(!ordering)}
              >
                {ordering ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <ListOrdered size={16} aria-hidden="true" className="hidden @min-[28rem]:block" />
                )}
                <span className="@min-[28rem]:hidden">{ordering ? '完成排序' : '排序'}</span>
                <span className="hidden @min-[28rem]:inline">
                  {ordering ? '完成排序' : '调整顺序'}
                </span>
              </Button>
            )}
            {!ordering && (
              <>
                <DropdownMenu
                  label="导入模板"
                  items={ruleTemplates.map(({ label, rules: templateRules }) => {
                    const additions = templateRules.filter(
                      (item) => !rules.some((rule) => rule.id === item.id),
                    );
                    return {
                      label,
                      disabled:
                        disabled || !additions.length || rules.length + additions.length > 128,
                      onSelect: () => {
                        patch({
                          rules: [
                            ...rules,
                            ...additions.map((rule) => ({
                              ...rule,
                              enabled: true,
                              match_all: false,
                            })),
                          ],
                        });
                        setNotice(`已将 ${additions.length} 条规则加入草稿末尾`);
                      },
                    };
                  })}
                />
                <Button
                  ref={addTrigger}
                  variant="secondary"
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
                  <Plus size={16} aria-hidden="true" />
                  添加规则
                </Button>
              </>
            )}
          </div>
        </div>
        {rules.length > 0 ? (
          <ol
            className="list-none divide-y-[1px] divide-border border-y-[1px] border-border"
            aria-label="分流规则匹配顺序"
          >
            {rules.map((rule, index) => {
              const outlet = options.find((option) => option.value === rule.outbound);
              return (
                <RoutingRuleRow
                  key={rule.id}
                  rule={rule}
                  ordering={ordering}
                  index={index}
                  count={rules.length}
                  services={rule.inbound?.map((id) => serviceNames.get(id) ?? id) ?? []}
                  outlet={outlet}
                  disabled={disabled}
                  canEditExit={canEditExit}
                  onMove={(next) => move(index, next)}
                  onToggle={(enabled) => {
                    if (
                      enabled &&
                      outlet?.http &&
                      (rule.network?.length !== 1 || rule.network[0] !== 'tcp')
                    ) {
                      toast({
                        id: 'route-enable-http',
                        type: 'error',
                        title: '无法启用规则',
                        description: 'HTTP CONNECT 仅支持 TCP。请先编辑规则或更换出口。',
                      });
                      return;
                    }
                    patch({
                      rules: rules.map((item) =>
                        item.id === rule.id ? { ...item, enabled } : item,
                      ),
                    });
                  }}
                  onEdit={(event) => edit(rule, event.currentTarget)}
                  onCopy={() => {
                    const copy = {
                      ...rule,
                      id: crypto.randomUUID(),
                      name: copiedRuleName(rule.name),
                    };
                    patch({ rules: [...rules, copy] });
                    setNotice(`已复制 ${rule.name}，副本位于草稿末尾`);
                  }}
                  onDelete={(event) => {
                    overlayTrigger.current = event.currentTarget;
                    setDeleting(rule);
                  }}
                />
              );
            })}
          </ol>
        ) : (
          <p className="border-t-[1px] border-border py-6 text-center text-(length:--text-sm) text-text-secondary">
            尚无分流规则
          </p>
        )}
        <span className="sr-only" role="status">
          {notice}
        </span>
      </section>
      <section aria-labelledby={policyId} className="min-w-0 space-y-3">
        <h3 id={policyId} className="text-(length:--text-sm) font-medium text-foreground">
          默认策略
        </h3>
        <dl className="divide-y-[1px] divide-border border-y-[1px] border-border text-(length:--text-sm)">
          <div className={policyRow}>
            <dt className={policyLabel}>默认出口</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="w-full min-w-0 max-w-72">
                <Select
                  label="默认出口"
                  description="未命中任何启用规则时使用。"
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
              {needsCatalog && !loading && (
                <Button variant="ghost" onClick={onRefresh}>
                  <RefreshCw size={16} aria-hidden="true" />
                  刷新出口列表
                </Button>
              )}
            </dd>
          </div>
          <div className={policyRow}>
            <dt id={`${policyId}-sniff`} className={policyLabel}>
              域名嗅探
            </dt>
            <dd>
              <Switch
                aria-labelledby={`${policyId}-sniff`}
                checked={routing.sniff}
                disabled={disabled}
                onCheckedChange={(sniff) => patch({ sniff })}
              />
            </dd>
          </div>
        </dl>
      </section>

      {editing && (
        <RuleEditor
          key={editing.id}
          rule={editing}
          editing={rules.some((rule) => rule.id === editing.id)}
          services={services.filter((service) => !service.pending_delete)}
          options={options}
          disabled={!canEditExit}
          returnFocus={returnFocus}
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
      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        >
          <DialogContent
            title="删除分流规则"
            description={`将「${deleting.name}」从草稿中移除。发布后此规则将停止匹配流量。`}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocus();
            }}
            footer={
              <>
                <Button variant="secondary" onClick={() => setDeleting(null)}>
                  取消
                </Button>
                <Button
                  variant="danger"
                  disabled={disabled}
                  onClick={() => {
                    patch({ rules: rules.filter((item) => item.id !== deleting.id) });
                    setNotice(`已从草稿删除 ${deleting.name}`);
                    setDeleting(null);
                  }}
                >
                  删除规则
                </Button>
              </>
            }
          />
        </Dialog>
      )}
    </div>
  );
}
