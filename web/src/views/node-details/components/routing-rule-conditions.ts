import type { RouteRule } from '@/api/outbounds';

export const routeConditionGroups = [
  {
    key: 'domain',
    title: '域名与站点',
    fields: [
      {
        key: 'geosite',
        label: 'GeoSite',
      },
      { key: 'domain', label: '完整域名', placeholder: '例如 www.example.com' },
      { key: 'domain_suffix', label: '域名后缀', placeholder: '例如 example.com' },
    ],
  },
  {
    key: 'ip',
    title: 'IP 与地理位置',
    fields: [
      {
        key: 'geoip',
        label: 'GeoIP',
      },
      { key: 'ip_cidr', label: 'IP 网段', placeholder: '例如 192.0.2.0/24' },
    ],
  },
  {
    key: 'transport',
    title: '协议与端口',
    fields: [
      { key: 'port', label: '端口', placeholder: '例如 443' },
      { key: 'port_range', label: '端口范围', placeholder: '例如 8000:8080' },
    ],
  },
] as const;

type ConditionKey = (typeof routeConditionGroups)[number]['fields'][number]['key'];

export function routeConditionValues(rule: RouteRule, key: ConditionKey) {
  return rule[key]?.map(String) ?? [];
}

export function routeMatchConditions(rule: RouteRule, ports = routeConditionValues(rule, 'port')) {
  return routeConditionGroups.map(({ key, title, fields }) => ({
    key,
    title,
    conditions: [
      ...fields.flatMap(({ key, label }) => {
        const values = key === 'port' ? ports : routeConditionValues(rule, key);
        return values.length ? [{ label, values }] : [];
      }),
      ...(key === 'transport' && rule.network?.length
        ? [{ label: '传输协议', values: rule.network.map((protocol) => protocol.toUpperCase()) }]
        : []),
    ],
  }));
}

export function routeMatchSummary(
  rule: RouteRule,
  services: string[],
  outlet: string,
  ports: string[],
) {
  const scope = services.length ? services.join('、') : '全部服务';
  const conditions = routeMatchConditions(rule, ports)
    .flatMap(({ conditions }) => conditions)
    .map(
      ({ label, values }) =>
        `${label}为 ${values.length > 1 ? `（${values.join(' 或 ')}）` : values[0]}`,
    );

  if (!rule.enabled) return '规则已停用。';
  if (rule.match_all) return `${scope}的全部流量使用「${outlet}」。`;
  if (!conditions.length) return '请添加匹配条件。';
  return `${scope}的流量满足${conditions.join(' 且 ')}时，使用「${outlet}」。`;
}

export function routeConditionError(rule: RouteRule) {
  const groups = routeMatchConditions(rule);
  if (groups.some(({ conditions }) => conditions.some(({ values }) => values.length > 64))) {
    return '每个匹配字段最多添加 64 项。';
  }
  if (rule.geoip?.some((code) => !/^[a-z0-9_-]{2,32}$/.test(code))) {
    return 'GeoIP 须为 2 至 32 位小写字母、数字、下划线或连字符。';
  }
  if (rule.geosite?.some((code) => !/^[a-z0-9_@!-]{1,64}$/.test(code))) {
    return 'GeoSite 须为 1 至 64 位小写字母、数字、下划线、连字符、@ 或 !。';
  }
  if (rule.port?.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
    return '端口须为 1 至 65535 的整数。';
  }
  if (
    rule.port_range?.some((range) => {
      if (!/^\d{1,5}:\d{1,5}$/.test(range)) return true;
      const [start, end] = range.split(':').map(Number);
      return start < 1 || end > 65535 || start > end;
    })
  ) {
    return '端口范围须按起始:结束填写，且两端均为 1 至 65535 的整数。';
  }
  if (!groups.some(({ conditions }) => conditions.length)) {
    return '请添加匹配条件，或选择匹配全部流量。';
  }
  return '';
}
