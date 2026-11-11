import type { EngineDraft, EngineService } from '@/api/engines';
import type { RouteRule } from '@/api/outbounds';

export interface DraftChange {
  id: string;
  name: string;
  kind: '新增' | '删除' | '修改';
  fields: { label: string; before: string; after: string }[];
}

const serviceFields: [keyof EngineService, string][] = [
  ['name', '名称'],
  ['enabled', '启用状态'],
  ['preset_id', '协议配置'],
  ['listen_host', '监听地址'],
  ['listen_port', '监听端口'],
  ['port_override', '覆盖端口'],
  ['sni_override', '覆盖服务器名称'],
  ['target_host', '目标地址'],
  ['target_port', '目标端口'],
  ['server_name', '服务器名称'],
  ['public_host', '公网地址'],
  ['public_port', '公网端口'],
];
const ruleFields: [keyof RouteRule, string][] = [
  ['name', '名称'],
  ['enabled', '启用状态'],
  ['inbound', '入站服务'],
  ['domain', '域名'],
  ['domain_suffix', '域名后缀'],
  ['ip_cidr', 'IP 网段'],
  ['port', '端口'],
  ['port_range', '端口范围'],
  ['network', '传输协议'],
  ['outbound', '出口'],
  ['match_all', '匹配全部'],
];
function display(value: unknown): string {
  if (value === undefined || value === null || value === '' || value === 0) return '未设置';
  if (typeof value === 'boolean') return value ? '启用' : '停用';
  if (Array.isArray(value)) return value.length ? value.join('、') : '未设置';
  return String(value);
}
function fields<T>(before: T | undefined, after: T | undefined, labels: [keyof T, string][]) {
  return labels.flatMap(([key, label]) => {
    const oldValue = before ? display(before[key]) : '无';
    const newValue = after ? display(after[key]) : '无';
    return oldValue === newValue ? [] : [{ label, before: oldValue, after: newValue }];
  });
}

// Compare public configuration only. Draft counters and audit metadata are not changes.
export function engineDraftChanges(
  draft: EngineDraft,
  published: EngineDraft | null,
): DraftChange[] {
  const changes: DraftChange[] = [];
  const oldServices = published?.services ?? [];
  const nextServices = draft.services.filter((service) => !service.pending_delete);
  for (const [id, service] of new Map(
    [...oldServices, ...nextServices].map((service) => [service.id, service]),
  )) {
    const before = oldServices.find((service) => service.id === id);
    const after = nextServices.find((service) => service.id === id);
    const changed = fields(before, after, serviceFields);
    if (changed.length)
      changes.push({
        id: `service-${id}`,
        name: service.name,
        kind: !before ? '新增' : !after ? '删除' : '修改',
        fields: changed,
      });
  }
  const oldRouting = published?.routing;
  const nextRouting = draft.routing;
  const routingFields = fields(oldRouting, nextRouting, [
    ['outbound_ids', '引用出口'],
    ['final', '默认出口'],
    ['sniff', '协议嗅探'],
  ]);
  const oldRules = oldRouting?.rules ?? [];
  const nextRules = nextRouting?.rules ?? [];
  if (oldRules.map((rule) => rule.id).join(',') !== nextRules.map((rule) => rule.id).join(',')) {
    routingFields.push({
      label: '规则顺序',
      before: oldRules.map((r) => r.name).join(' → ') || '无',
      after: nextRules.map((r) => r.name).join(' → ') || '无',
    });
  }
  if (routingFields.length)
    changes.push({
      id: 'routing',
      name: '分流配置',
      kind: !oldRouting ? '新增' : !nextRouting ? '删除' : '修改',
      fields: routingFields,
    });
  for (const [id, rule] of new Map([...oldRules, ...nextRules].map((rule) => [rule.id, rule]))) {
    const before = oldRules.find((rule) => rule.id === id);
    const after = nextRules.find((rule) => rule.id === id);
    const changed = fields(before, after, ruleFields);
    if (changed.length)
      changes.push({
        id: `rule-${id}`,
        name: `分流规则：${rule.name}`,
        kind: !before ? '新增' : !after ? '删除' : '修改',
        fields: changed,
      });
  }
  return changes;
}
