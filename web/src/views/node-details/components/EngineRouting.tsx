import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { EngineService } from '@/api/engines';
import {
  allOutbounds,
  defaultRouting,
  type Outbound,
  type RouteRule,
  type EngineRouting as Routing,
} from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Select } from '@/components/arc/select/select';
import { SortableDataTable } from '@/components/arc/sortable-data-table/sortable-data-table';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

import RuleEditor from './RoutingRuleEditor';

interface Props {
  routing: Routing | undefined;
  services: EngineService[];
  disabled: boolean;
  view: 'outbounds' | 'routing';
  onChange: (routing: Routing) => void;
}
export default function EngineRouting({ routing, services, disabled, view, onChange }: Props) {
  const r = routing ?? defaultRouting();
  const { toast } = useToastStack();
  const [items, setItems] = useState<Outbound[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<RouteRule | null>(null);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    try {
      const data = await allOutbounds(controller.signal);
      if (!controller.signal.aborted) setItems(data);
    } catch (e) {
      if (!controller.signal.aborted)
        toast({
          id: 'node-outbounds',
          type: 'error',
          title: '未能读取共享出口',
          description: e instanceof Error ? e.message : '请刷新出口列表。',
        });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);
  const refs = r.outbound_ids.map((id) => ({ id, outbound: items?.find((o) => o.id === id) }));
  const options = [
    { value: 'direct', label: '本机直连' },
    { value: 'reject', label: '拒绝连接' },
    ...refs.map((ref) => ({
      value: ref.id,
      label: ref.outbound?.config.name ?? `未读取的出口 ${ref.id}`,
    })),
  ];
  const name = (id: string) => options.find((o) => o.value === id)?.label ?? id;
  const patch = (p: Partial<Routing>) => onChange({ ...r, ...p });
  function move(index: number, delta: number) {
    const rules = [...r.rules];
    const other = rules[index + delta];
    if (!other) return;
    rules[index + delta] = rules[index];
    rules[index] = other;
    patch({ rules });
  }
  return (
    <section
      className="min-w-0 space-y-4"
      aria-label={view === 'outbounds' ? '引用出口' : '分流规则'}
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-text-secondary">
          {view === 'outbounds'
            ? '节点仅引用共享出口，参数在全局出口配置中修改。'
            : '按顺序匹配，第一条命中规则决定出口。同一条件内为“或”，不同条件之间为“且”。'}
        </p>
        <Button variant="secondary" disabled={loading} onClick={load}>
          刷新出口列表
        </Button>
      </div>
      {view === 'outbounds' ? (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <Select
              label="共享出口"
              value={selected}
              onValueChange={setSelected}
              disabled={disabled || items === null || loading}
              placeholder="选择要引用的出口"
              options={(items ?? [])
                .filter((o) => !r.outbound_ids.includes(o.id))
                .map((o) => ({ value: o.id, label: `${o.config.name} (${o.config.type})` }))}
            />
            <Button
              variant="secondary"
              disabled={
                disabled || items === null || loading || !selected || r.outbound_ids.length >= 32
              }
              onClick={() => {
                patch({ outbound_ids: [...r.outbound_ids, selected] });
                setSelected('');
              }}
            >
              添加出口引用
            </Button>
            <Link
              className="inline-flex items-center text-accent"
              to="/proxy/outbounds"
              target="_blank"
              rel="noreferrer"
            >
              前往出口配置
            </Link>
          </div>
          <p className="text-(length:--text-xs) text-text-secondary">
            本机直连始终可用。代理出口故障时不会自动回退直连。连通性尚未验证。
          </p>
          <div className="min-w-0 overflow-x-auto">
            <SortableDataTable
              rows={refs}
              rowKey="id"
              caption="节点引用的出口"
              emptyMessage={
                items === null ? '共享出口尚未读取' : '尚未引用代理出口，可使用本机直连。'
              }
              columns={[
                {
                  key: 'name',
                  label: '出口名称',
                  render: (_, row) => row.outbound?.config.name ?? row.id,
                },
                {
                  key: 'server',
                  label: '服务器',
                  render: (_, row) => (
                    <span className="break-all">
                      {row.outbound
                        ? `${row.outbound.config.server}:${row.outbound.config.server_port}`
                        : '尚未读取'}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  label: '操作',
                  sortable: false,
                  render: (_, row) => (
                    <Button
                      variant="secondary"
                      disabled={
                        disabled ||
                        r.final === row.id ||
                        r.rules.some((rule) => rule.outbound === row.id)
                      }
                      onClick={() =>
                        patch({ outbound_ids: r.outbound_ids.filter((id) => id !== row.id) })
                      }
                    >
                      移除引用
                    </Button>
                  ),
                },
              ]}
            />
          </div>
          <p className="text-(length:--text-xs) text-text-secondary">
            被规则或默认出口使用的引用，需先调整分流才能移除。
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <Select
              label="域名识别"
              value={r.sniff ? 'yes' : 'no'}
              options={[
                { value: 'yes', label: '尝试嗅探域名' },
                { value: 'no', label: '仅使用请求提供的域名' },
              ]}
              disabled={disabled}
              onValueChange={(v) => patch({ sniff: v === 'yes' })}
            />
            <Button
              variant="secondary"
              disabled={disabled || items === null || r.rules.length >= 128}
              onClick={() =>
                setEditing({
                  id: crypto.randomUUID(),
                  name: '',
                  enabled: true,
                  outbound: 'direct',
                  match_all: false,
                })
              }
            >
              添加分流规则
            </Button>
          </div>
          <p className="text-(length:--text-xs) text-text-secondary">
            无法识别域名时继续匹配其他规则。DNS 使用节点本地解析器，DNS 查询不随业务流量出口切换。
          </p>
          <ol className="divide-y-[1px] divide-border">
            {r.rules.map((rule, index) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="min-w-0 space-y-1">
                  <p className="break-all">
                    <span className="tabular-nums">{index + 1}.</span> {rule.name} /{' '}
                    {rule.enabled ? '启用' : '停用'} → {name(rule.outbound)}
                  </p>
                  <p className="break-all text-(length:--text-xs) text-text-secondary">
                    {ruleSummary(rule, services)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    ['编辑规则', () => setEditing(rule), false],
                    [
                      '复制规则',
                      () =>
                        patch({
                          rules: [
                            ...r.rules,
                            {
                              ...rule,
                              id: crypto.randomUUID(),
                              name: `${rule.name.slice(0, 110)} 副本`,
                            },
                          ],
                        }),
                      r.rules.length >= 128,
                    ],
                    ['上移规则', () => move(index, -1), index === 0],
                    ['下移规则', () => move(index, 1), index === r.rules.length - 1],
                    [
                      rule.enabled ? '停用规则' : '启用规则',
                      () =>
                        patch({
                          rules: r.rules.map((v) =>
                            v.id === rule.id ? { ...v, enabled: !v.enabled } : v,
                          ),
                        }),
                      false,
                    ],
                    [
                      '删除规则',
                      () => patch({ rules: r.rules.filter((v) => v.id !== rule.id) }),
                      false,
                    ],
                  ].map(([label, action, blocked]) => (
                    <Button
                      key={String(label)}
                      variant="secondary"
                      disabled={disabled || Boolean(blocked)}
                      onClick={action as () => void}
                    >
                      {String(label)}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {r.rules.length === 0 && (
            <p className="py-4 text-text-secondary">尚无分流规则，所有流量使用默认出口。</p>
          )}
          <Select
            label="未匹配流量"
            value={r.final}
            options={options.map((o) => ({
              ...o,
              disabled: refs.find((ref) => ref.id === o.value)?.outbound?.config.type === 'http',
            }))}
            disabled={disabled || items === null}
            onValueChange={(final) => patch({ final })}
          />
        </>
      )}
      {editing && (
        <RuleEditor
          rule={editing}
          services={services.filter((s) => !s.pending_delete)}
          options={options}
          onClose={() => setEditing(null)}
          onSave={(rule) => {
            patch({
              rules: r.rules.some((v) => v.id === rule.id)
                ? r.rules.map((v) => (v.id === rule.id ? rule : v))
                : [...r.rules, rule],
            });
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
export function ruleSummary(r: RouteRule, services: EngineService[]) {
  return [
    r.inbound?.length
      ? r.inbound.map((id) => services.find((s) => s.id === id)?.name ?? id).join('、')
      : '全部服务',
    r.match_all ? '全部流量' : '',
    [
      r.domain?.length ? `域名 ${r.domain.join('、')}` : '',
      r.domain_suffix?.length ? `域名后缀 ${r.domain_suffix.join('、')}` : '',
      r.ip_cidr?.length ? `IP ${r.ip_cidr.join('、')}` : '',
      r.port?.length ? `端口 ${r.port.join('、')}` : '',
      r.port_range?.join('、') ?? '',
      r.network?.join('、') ?? '',
    ]
      .filter(Boolean)
      .join('，'),
  ]
    .filter(Boolean)
    .join('，');
}
