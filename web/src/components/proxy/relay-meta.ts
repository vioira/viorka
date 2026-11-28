import type { Endpoint, RelayPath, RelayRoute } from '@/api/relays';
import type { BadgeTone } from '@/components/arc/badge/badge';
import type { DraftChange } from '@/views/node-details/components/engine-draft-diff';

export type RelayLens = 'all' | 'available' | 'pending' | 'attention';
export type RelayStepState = 'passed' | 'pending' | 'failed' | 'idle';

export interface RelayCheckStep {
  key: 'apply' | 'dial' | 'public';
  title: string;
  state: RelayStepState;
  statusText: string;
  detail: string;
}

export interface RelayServiceSummary {
  total: number;
  available: number;
  pending: number;
  attention: number;
}

export interface AffectedRelayImpact {
  route: RelayRoute;
  changeKind: DraftChange['kind'];
  reason: string;
}

const reasonLabels: Record<string, string> = {
  available: '可供订阅',
  draft: '草稿未发布',
  permission_lost: '落地导出权限已失效',
  awaiting_apply: '等待配置应用与监听确认',
  probe_unconfirmed: '入口 Agent 未能核对生效规则',
  runtime_unconfirmed: '实例运行状态待核对',
  landing_unavailable: '落地运行状态待核对',
  landing_changed: '落地连接已变化',
  awaiting_public: '等待公网检测',
  public_mapping_changed: '公网端点授权已变化',
  public_failed: '公网检测失败',
  probe_unavailable: '探测点不可用',
  disabled: '已停止分发',
  restore_verification_required: '等待恢复核对',
};

const taskStateLabels: Record<string, string> = {
  queued: '等待派发',
  dispatched: '已派发',
  accepted: 'Agent 已接收',
  running: '执行中',
  succeeded: '执行成功',
  failed: '执行失败',
  cancelled: '已取消',
};

const probeStageLabels: Record<string, string> = {
  passed: '通过',
  timeout: '连接超时',
  refused: '连接被拒绝',
  dns: 'DNS 解析失败',
  unreachable: '目标不可达',
};

const publicProbeDetailLabels: Record<string, string> = {
  timeout: '公网入口 TCP 连接超时，请检查安全组、防火墙或服务商端口映射。',
  refused: '公网入口拒绝了 TCP 连接，请核对 Realm 监听端口与映射规则。',
  unreachable: '无法连接到公网入口，请核对公网 IP 或域名可达性。',
  dns: '公网入口域名解析失败，请检查 DNS 记录。',
  target_not_authorized: '入口地址归属或公网 TCP 端口映射未获授权，请核对节点资产与配置。',
  source_missing: 'Panel 尚未配置公网探测点，无法确认外网可达性。',
  source_network: 'Panel 无法确认外网视角，请配置外部探测点。',
  probe_connection: '无法连接到外部探测点，请检查网络和 TLS 配置。',
  probe_rejected: '外部探测点拒绝了请求，请检查授权配置。',
  permission_lost: '探测请求人的线路授权已失效。',
};

export function endpointText(e?: Endpoint | null) {
  if (!e?.host || !e.port) return '未填写';
  return `${e.host.includes(':') && !e.host.startsWith('[') ? `[${e.host}]` : e.host}:${e.port}`;
}

export function localTime(v?: string) {
  return v ? new Date(v).toLocaleString() : '尚无记录';
}

export function isNatMapped(path?: Pick<RelayPath, 'public' | 'listen'> | null) {
  return Boolean(
    path && path.public.port > 0 && path.listen.port > 0 && path.public.port !== path.listen.port,
  );
}

export function reasonLabel(reason: string) {
  return reasonLabels[reason] ?? '状态未知';
}

export function taskStateLabel(state?: string) {
  return (state && taskStateLabels[state]) || '尚无任务';
}

export function probeStageLabel(raw?: string) {
  return (raw && probeStageLabels[raw]) || '未知';
}

export function publicProbeDetailText(detail?: string) {
  if (!detail) return '';
  return publicProbeDetailLabels[detail] ?? '请检查探测点与入口公网端口配置。';
}

export function relayStatusLabel(route: RelayRoute) {
  if (route.reason === 'awaiting_apply' && route.task_state === 'failed') return '发布失败';
  if (route.reason === 'awaiting_apply' && route.task_state === 'cancelled') return '发布已取消';
  if (route.stopped_at && !route.removed_at)
    return ['failed', 'cancelled'].includes(route.task_state) ? '撤除未完成' : '等待撤除';
  if (route.reason === 'awaiting_public' && route.public_probe?.state === 'checking')
    return '公网检测中';
  return reasonLabel(route.reason);
}

export function needsRelayPublication(route: RelayRoute) {
  return (
    route.published?.version !== route.draft.version ||
    Boolean(route.stopped_at) ||
    ['failed', 'cancelled'].includes(route.task_state) ||
    route.reason === 'runtime_unconfirmed'
  );
}

export function canRetestPublicProbe(route: RelayRoute) {
  return (
    route.applied_running &&
    [
      'awaiting_public',
      'public_mapping_changed',
      'public_failed',
      'probe_unavailable',
      'available',
    ].includes(route.reason)
  );
}

export function canProbeEntryToLanding(route: RelayRoute) {
  return (
    route.probe_capable && (canRetestPublicProbe(route) || route.reason === 'probe_unconfirmed')
  );
}

export function canWithdrawRelay(route: RelayRoute) {
  return (
    route.target_revision > 0 &&
    (!route.stopped_at || ['failed', 'cancelled'].includes(route.task_state))
  );
}

export function canDeleteRelay(route: RelayRoute) {
  return !route.target_revision || Boolean(route.removed_at);
}

export function isRelayPending(route: RelayRoute) {
  if (
    route.stopped_at &&
    !route.removed_at &&
    !['failed', 'cancelled'].includes(route.task_state)
  ) {
    return true;
  }
  if (route.reason === 'awaiting_apply' && ['failed', 'cancelled'].includes(route.task_state)) {
    return false;
  }
  return ['draft', 'awaiting_apply', 'awaiting_public', 'restore_verification_required'].includes(
    route.reason,
  );
}

export function isRelayAttention(route: RelayRoute) {
  if (route.reason === 'disabled' && route.removed_at) return false;
  if (route.stopped_at && !route.removed_at && ['failed', 'cancelled'].includes(route.task_state)) {
    return true;
  }
  if (route.reason === 'awaiting_apply' && ['failed', 'cancelled'].includes(route.task_state)) {
    return true;
  }
  if (route.reason === 'available' && (!route.online || route.public_stale)) {
    return true;
  }
  return [
    'permission_lost',
    'probe_unconfirmed',
    'runtime_unconfirmed',
    'landing_unavailable',
    'landing_changed',
    'public_mapping_changed',
    'public_failed',
    'probe_unavailable',
  ].includes(route.reason);
}

export function relayTone(route: RelayRoute): BadgeTone {
  if (route.reason === 'available') {
    return route.online && !route.public_stale ? 'success' : 'warning';
  }
  if (route.reason === 'disabled') {
    return route.stopped_at &&
      !route.removed_at &&
      ['failed', 'cancelled'].includes(route.task_state)
      ? 'danger'
      : 'neutral';
  }
  if (
    route.reason === 'public_failed' ||
    route.reason === 'permission_lost' ||
    (route.reason === 'awaiting_apply' && ['failed', 'cancelled'].includes(route.task_state))
  ) {
    return 'danger';
  }
  if (isRelayAttention(route) || isRelayPending(route)) return 'warning';
  return 'neutral';
}

export function relayNextHint(route: RelayRoute): string {
  if (route.cleanup_only || route.reason === 'permission_lost') {
    return '落地服务的导出权限已失效，当前仅允许停用撤除或删除此线路。';
  }
  if (route.stopped_at && !route.removed_at) {
    return ['failed', 'cancelled'].includes(route.task_state)
      ? '撤除任务未完成，请确认入口节点在线后重新提交撤除。'
      : '已停止订阅分发，等待入口节点完成规则撤除。';
  }
  if (route.reason === 'disabled') {
    return '线路已停用并撤除，可重新审查发布或删除记录。';
  }
  if (route.reason === 'draft') {
    return '草稿尚未发布到入口节点，审查并发布后将自动执行公网探测。';
  }
  if (route.reason === 'landing_changed') {
    return '落地服务的连接参数已变更，请重新编辑草稿确认最新拨号目标并发布。';
  }
  if (route.reason === 'landing_unavailable') {
    return '落地代理服务当前未确认运行，请先检查落地节点与引擎状态。';
  }
  if (route.reason === 'awaiting_apply') {
    if (['failed', 'cancelled'].includes(route.task_state)) {
      return '发布任务未成功，请核对入口端口冲突或节点状态后重新发布。';
    }
    return '正在等待入口 Realm 应用配置并确认本地监听。';
  }
  if (route.reason === 'runtime_unconfirmed') {
    return '入口 Realm 运行状态待核对，请检查入口节点在线状态或重新发布。';
  }
  if (route.reason === 'probe_unconfirmed') {
    return '入口 Agent 未能核对生效规则，可尝试重测入口到落地连通性。';
  }
  if (route.reason === 'public_failed') {
    return (
      publicProbeDetailText(route.public_probe?.detail) || '公网探测失败，请核对端口映射后重测。'
    );
  }
  if (route.reason === 'probe_unavailable') {
    return (
      publicProbeDetailText(route.public_probe?.detail) || '公网探测点不可用，请检查探测点配置。'
    );
  }
  if (route.reason === 'public_mapping_changed') {
    return '公网端点授权已变化，请核对入口公网映射后重新检测。';
  }
  if (route.reason === 'awaiting_public') {
    return '入口规则已运行，正在等待公网 TCP 入口验证通过后开放订阅。';
  }
  if (route.reason === 'restore_verification_required') {
    return '备份恢复后需重新完成入口与落地核对，验证通过后自动恢复分发。';
  }
  if (route.reason === 'available') {
    if (!route.online) return '当前保留已确认的订阅输出，但入口 Agent 离线，建议核对节点连接。';
    if (route.public_stale) return '当前可供订阅，距上次公网验证已超过 24 小时，建议重新检测。';
    if (route.published && route.published.version !== route.draft.version) {
      return '当前继续使用已发布版本分发，草稿修改需审查发布后生效。';
    }
    return '已完成本地监听、拨号转发与公网入口验证，可供订阅选择。';
  }
  return '';
}

export function relayVerificationSteps(route: RelayRoute): RelayCheckStep[] {
  const path = route.published ?? route.draft;

  // Step 1: Apply & local listen
  let applyState: RelayStepState = 'idle';
  let applyStatus = '尚未发布';
  let applyDetail = `目标监听 ${endpointText(path.listen)}`;
  if (route.stopped_at && !route.removed_at) {
    applyState = ['failed', 'cancelled'].includes(route.task_state) ? 'failed' : 'pending';
    applyStatus = ['failed', 'cancelled'].includes(route.task_state) ? '撤除失败' : '等待撤除';
    applyDetail = `任务状态 ${taskStateLabel(route.task_state)}`;
  } else if (route.reason === 'disabled') {
    applyState = 'idle';
    applyStatus = '已撤除';
    applyDetail = route.removed_at ? `撤除于 ${localTime(route.removed_at)}` : '规则已停用';
  } else if (route.target_revision === 0) {
    applyState = 'idle';
    applyStatus = '草稿未发布';
    applyDetail = `草稿 v${route.draft.version}，尚未下发至 ${route.entry_name}`;
  } else if (route.applied_running) {
    const listenFailed = route.probe?.listen && route.probe.listen !== 'passed';
    applyState = listenFailed ? 'failed' : 'passed';
    applyStatus = listenFailed
      ? `监听${probeStageLabel(route.probe?.listen)}`
      : `已运行 r${route.observed_revision}`;
    applyDetail = route.probe?.listen
      ? `本地监听 ${endpointText(path.listen)}，核对于 ${localTime(route.probe.at)}`
      : `本地监听 ${endpointText(path.listen)}，确认于 ${localTime(route.task_at || route.observed_at)}`;
  } else if (['failed', 'cancelled'].includes(route.task_state)) {
    applyState = 'failed';
    applyStatus = route.task_state === 'cancelled' ? '发布取消' : '应用失败';
    applyDetail = route.error_code
      ? `错误码 ${route.error_code}`
      : `目标 r${route.target_revision} 未生效`;
  } else {
    applyState = 'pending';
    applyStatus = taskStateLabel(route.task_state);
    applyDetail = `目标 r${route.target_revision}，当前实测 r${route.observed_revision}`;
  }

  // Step 2: Entry -> Landing dial
  let dialState: RelayStepState = 'idle';
  let dialStatus = '待确认';
  let dialDetail = route.cleanup_only ? '落地导出权限已撤销' : `拨号至 ${endpointText(path.dial)}`;
  if (route.cleanup_only || route.reason === 'permission_lost') {
    dialState = 'failed';
    dialStatus = '权限失效';
    dialDetail = '已失去落地服务的导出授权';
  } else if (route.reason === 'landing_changed') {
    dialState = 'failed';
    dialStatus = '落地已变更';
    dialDetail = `引用落地 r${path.landing_revision} 已过期，需重新确认`;
  } else if (route.reason === 'landing_unavailable') {
    dialState = 'failed';
    dialStatus = '落地不可用';
    dialDetail = `${path.landing_name || '落地服务'} 当前未确认运行`;
  } else if (route.probe?.dial) {
    const ok = route.probe.dial === 'passed';
    dialState = ok ? 'passed' : 'failed';
    dialStatus = ok ? '拨号通过' : probeStageLabel(route.probe.dial);
    dialDetail = `拨号 ${endpointText(path.dial)}，测于 ${localTime(route.probe.at)}`;
  } else if (route.applied_running && route.published) {
    dialState = 'passed';
    dialStatus = 'Agent 已通过';
    dialDetail = `已验证拨号 ${endpointText(route.published.dial)}`;
  } else if (route.target_revision > 0 && !route.stopped_at) {
    dialState = 'pending';
    dialStatus = '等待验证';
  }

  // Step 3: Public TCP probe & subscription eligibility
  const q = route.public_probe;
  let publicState: RelayStepState = 'idle';
  let publicStatus = '待检测';
  let publicDetail = `公网入口 ${endpointText(path.public)}`;
  if (route.stopped_at || route.reason === 'disabled') {
    publicState = 'idle';
    publicStatus = '停止分发';
    publicDetail = '订阅拉取已排除该中转入口';
  } else if (route.reason === 'available') {
    publicState = route.public_stale ? 'pending' : 'passed';
    publicStatus = route.public_stale ? '验证已过期' : '可供订阅';
    const sourceText =
      q?.source === 'external' ? '外部探测点' : q?.source === 'panel' ? 'Panel' : '';
    publicDetail = [
      `生效 r${route.serving_revision}`,
      sourceText,
      route.verified_at ? localTime(route.verified_at) : '',
    ]
      .filter(Boolean)
      .join('，');
  } else if (q) {
    if (q.state === 'queued' || q.state === 'checking') {
      publicState = 'pending';
      publicStatus = q.state === 'checking' ? '检测中' : '等待检测';
      publicDetail = `${endpointText(q.endpoint)}，目标 r${q.revision}`;
    } else if (q.state === 'failed' || q.state === 'unavailable') {
      publicState = 'failed';
      publicStatus = q.state === 'unavailable' ? '探测点不可用' : '检测失败';
      publicDetail = publicProbeDetailText(q.detail) || `${endpointText(q.endpoint)} 探测未通过`;
    } else if (q.state === 'passed') {
      publicState = route.reason === 'public_mapping_changed' ? 'failed' : 'passed';
      publicStatus = route.reason === 'public_mapping_changed' ? '映射授权变化' : '上次通过';
      publicDetail = `${endpointText(q.endpoint)}，${localTime(q.at)}`;
    }
  } else if (route.reason === 'awaiting_public') {
    publicState = 'pending';
    publicStatus = '排队检测';
    publicDetail = `等待检测 ${endpointText(path.public)}`;
  }

  return [
    {
      key: 'apply',
      title: '实例应用与本地监听',
      state: applyState,
      statusText: applyStatus,
      detail: applyDetail,
    },
    {
      key: 'dial',
      title: '入口到落地拨号',
      state: dialState,
      statusText: dialStatus,
      detail: dialDetail,
    },
    {
      key: 'public',
      title: '公网入口与订阅分发',
      state: publicState,
      statusText: publicStatus,
      detail: publicDetail,
    },
  ];
}

export function summarizeServiceRelays(routes: RelayRoute[]): RelayServiceSummary {
  let available = 0;
  let pending = 0;
  let attention = 0;
  for (const route of routes) {
    if (route.reason === 'available' && route.online && !route.public_stale) available++;
    else if (isRelayAttention(route)) attention++;
    else if (isRelayPending(route)) pending++;
  }
  return { total: routes.length, available, pending, attention };
}

const connectionSensitiveFields = new Set([
  '公网地址',
  '公网端口',
  '监听地址',
  '监听端口',
  '握手目标',
  '目标端口',
  'SNI',
  '状态',
]);

export function findAffectedRelaysForDraftChanges(
  routes: RelayRoute[],
  changes: DraftChange[],
): AffectedRelayImpact[] {
  if (!routes.length || !changes.length) return [];
  const changeById = new Map(changes.map((c) => [c.id, c]));
  const impacts: AffectedRelayImpact[] = [];
  for (const route of routes) {
    if (route.reason === 'disabled' && route.removed_at) continue;
    const change = changeById.get(route.draft.landing_service_id);
    if (!change) continue;
    if (change.kind === '删除') {
      impacts.push({
        route,
        changeKind: '删除',
        reason: '落地服务将被删除，关联中转将失效并停止分发',
      });
      continue;
    }
    if (change.kind === '修改') {
      const hitFields = change.fields
        .map((f) => f.label)
        .filter((label) => connectionSensitiveFields.has(label));
      if (hitFields.length > 0) {
        impacts.push({
          route,
          changeKind: '修改',
          reason: `修改了${hitFields.join('、')}，发布后关联中转将暂停分发并需重新确认`,
        });
      }
    }
  }
  return impacts;
}

export function nodeEnginePath(nodeId: string, engineName: string) {
  return `/nodes/${encodeURIComponent(nodeId)}?tab=engines&engine=${encodeURIComponent(engineName)}`;
}

export function proxyServicePath(engineId: string, serviceId: string) {
  return `/proxy/services?service=${encodeURIComponent(`${engineId}/${serviceId}`)}`;
}

export function relayRoutePath(routeId: string) {
  return `/proxy/relays?route=${encodeURIComponent(routeId)}`;
}

export function createRelayForLandingPath(engineId: string, serviceId: string) {
  return `/proxy/relays?landing=${encodeURIComponent(engineId)}&service=${encodeURIComponent(serviceId)}`;
}

export function createRelayForEntryPath(engineId: string) {
  return `/proxy/relays?create=1&entry=${encodeURIComponent(engineId)}`;
}
