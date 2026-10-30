// Deliberate UI fixtures. Replace at the page data boundary when the API is connected.
export type OverviewNode = {
  id: string;
  region: string;
  kind: string;
  state: 'online' | 'offline' | 'degraded';
  engine: string;
  cpu: number | null;
  memory: number | null;
  traffic: number | null;
};

export const overviewNodes: OverviewNode[] = [
  {
    id: 'jp-nat-01',
    region: '东京',
    kind: 'NAT VPS',
    state: 'online',
    engine: 'sing-box 1.14',
    cpu: 34,
    memory: 51,
    traffic: 86.2,
  },
  {
    id: 'hk-relay-01',
    region: '香港',
    kind: '公网 VPS / 中转',
    state: 'online',
    engine: 'Realm 2.9',
    cpu: 22,
    memory: 38,
    traffic: 214.7,
  },
  {
    id: 'us-sea-01',
    region: '西雅图',
    kind: '公网 VPS',
    state: 'online',
    engine: 'Xray 26.3',
    cpu: 47,
    memory: 63,
    traffic: 158.4,
  },
  {
    id: 'de-fra-01',
    region: '法兰克福',
    kind: '公网 VPS',
    state: 'offline',
    engine: 'sing-box 1.14',
    cpu: null,
    memory: null,
    traffic: null,
  },
  {
    id: 'sg-01',
    region: '新加坡',
    kind: '公网 VPS',
    state: 'online',
    engine: 'sing-box 1.14',
    cpu: 18,
    memory: 29,
    traffic: 64.9,
  },
  {
    id: 'jp-nat-02',
    region: '大阪',
    kind: 'NAT VPS',
    state: 'online',
    engine: 'Xray 26.3',
    cpu: 41,
    memory: 44,
    traffic: 52.3,
  },
  {
    id: 'uk-lon-01',
    region: '伦敦',
    kind: '公网 VPS',
    state: 'online',
    engine: 'sing-box 1.13',
    cpu: 26,
    memory: 35,
    traffic: 41.8,
  },
  {
    id: 'kr-sel-01',
    region: '首尔',
    kind: 'NAT VPS',
    state: 'degraded',
    engine: 'sing-box 1.14',
    cpu: 67,
    memory: 72,
    traffic: 97.5,
  },
  {
    id: 'tw-tpe-01',
    region: '台北',
    kind: '公网 VPS',
    state: 'online',
    engine: 'Realm 2.9',
    cpu: 12,
    memory: 24,
    traffic: 128,
  },
  {
    id: 'us-lax-01',
    region: '洛杉矶',
    kind: '公网 VPS',
    state: 'online',
    engine: 'Xray 26.3',
    cpu: 39,
    memory: 48,
    traffic: 143.6,
  },
  {
    id: 'ca-tor-01',
    region: '多伦多',
    kind: '公网 VPS',
    state: 'online',
    engine: 'sing-box 1.14',
    cpu: 21,
    memory: 33,
    traffic: 38.4,
  },
  {
    id: 'au-syd-01',
    region: '悉尼',
    kind: 'NAT VPS',
    state: 'online',
    engine: 'sing-box 1.14',
    cpu: 29,
    memory: 40,
    traffic: 27.9,
  },
];

export const rangeOptions = [
  { value: 'day', label: '24 小时' },
  { value: 'week', label: '7 天' },
  { value: 'month', label: '30 天' },
];

const samples = [
  42, 56, 48, 72, 65, 90, 74, 52, 67, 80, 68, 96, 82, 73, 106, 94, 84, 116, 102, 91, 108, 124, 100,
  118,
];
function trafficPoints(range: string, count: number, totalGB: number) {
  const weights = Array.from({ length: count }, (_, i) => samples[i % samples.length]);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight, i) => {
    const label =
      range === 'day' ? `${String(i).padStart(2, '0')}:00` : `10 月 ${31 - count + i} 日`;
    const total = (weight / totalWeight) * totalGB;
    return {
      key: `${range}-${i}`,
      label,
      axisLabel: label,
      values: { outbound: total * 0.64, inbound: total * 0.36 },
    };
  });
}
export const trafficRanges = {
  day: {
    title: '近 24 小时流量',
    value: 286.4,
    unit: ' GB',
    change: '+8.2%',
    context: '较前 24 小时',
    bucket: '按小时聚合',
    points: trafficPoints('day', 24, 286.4),
  },
  week: {
    title: '近 7 天流量',
    value: 1.84,
    unit: ' TB',
    change: '+12.4%',
    context: '较前 7 天',
    bucket: '按天聚合',
    points: trafficPoints('week', 7, 1840),
  },
  month: {
    title: '近 30 天流量',
    value: 7.62,
    unit: ' TB',
    change: '+6.8%',
    context: '较前 30 天',
    bucket: '按天聚合',
    points: trafficPoints('month', 30, 7620),
  },
};
export type TrafficRange = keyof typeof trafficRanges;

export const attentionItems = [
  {
    id: 'offline',
    tone: 'danger',
    title: 'de-fra-01 离线 26 分钟',
    detail: '最后心跳 06:31，节点上的服务状态待确认',
  },
  {
    id: 'revision',
    tone: 'warning',
    title: 'jp-nat-01 有待发布修订',
    detail: '期望 r42，实际 r41，差异 1 个入站',
  },
  {
    id: 'quota',
    tone: 'warning',
    title: 'hk-relay-01 流量接近限额',
    detail: '本月已用 842 GB，上限 1 TB',
  },
  {
    id: 'degraded',
    tone: 'warning',
    title: 'kr-sel-01 运行受限',
    detail: '节点仍在线，请检查引擎与端口可用性',
  },
] as const;
