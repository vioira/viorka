import { ApiError } from '@/api/client';
import {
  type EngineRecord,
  type EngineService,
  type EngineSummary,
  getEngine,
  listEngines,
} from '@/api/engines';
import { listAllNodes, type NodeRecord } from '@/api/nodes';
import { getProtocolPreset } from '@/api/protocol-presets';
import { hasPublishedRelayLanding, listRelays, type RelayRoute } from '@/api/relays';
import { engineDraftChanges } from '../node-details/components/engine-draft-diff';

export type ServiceRow = {
  id: string;
  name: string;
  node: NodeRecord;
  engine: EngineRecord;
  service: EngineService;
  protocol: string;
  presetName: string;
  hasDraftChanges: boolean;
  endpoint: string;
  runtime: string;
  configuration: string;
  relays: RelayRoute[];
  relayEligible: boolean;
};

export const endpoint = (host: string, port: number) =>
  host && port ? `${host.includes(':') ? `[${host}]` : host}:${port}` : '未配置';

export function serviceRuntime(engine: EngineRecord, service: EngineService, online: boolean) {
  if (!online || engine.last_error === 'engine_external') return '未知';
  const published = engine.published_draft?.services.find((item) => item.id === service.id);
  if (!published) return '未发布';
  if (engine.observed_revision !== engine.published_revision) return '未知';
  if (!published.enabled || published.pending_delete || engine.status === 'stopped')
    return '已停止';
  return engine.status === 'running' ? '运行中' : engine.status === 'degraded' ? '异常' : '未知';
}

export function isServicePending(row: ServiceRow) {
  return ['草稿未发布', '待同步', '未发布', '待删除'].includes(row.configuration);
}

export function isServiceAttention(row: ServiceRow) {
  return (
    row.runtime === '异常' ||
    row.configuration === '应用失败' ||
    row.node.state !== 'online' ||
    row.engine.last_error === 'engine_external'
  );
}

async function loadAllRelays(
  signal: AbortSignal,
): Promise<{ items: RelayRoute[]; loaded: boolean }> {
  try {
    const items: RelayRoute[] = [];
    let after: string | undefined;
    do {
      const page = await listRelays(undefined, undefined, after, signal);
      items.push(...page.items);
      after = page.next_cursor;
    } while (after);
    return { items, loaded: true };
  } catch (error) {
    if (signal.aborted) throw error;
    return { items: [], loaded: false };
  }
}

export async function loadServices(signal: AbortSignal) {
  const [nodes, relayResult] = await Promise.all([listAllNodes(signal), loadAllRelays(signal)]);
  const engines: { node: NodeRecord; engine: EngineRecord }[] = [];
  const nodeEngines = new Map<string, EngineSummary[]>();
  let restricted = 0;

  // Bound requests to one node/engine at a time instead of fanning out across the fleet.
  for (const node of nodes) {
    try {
      const result = await listEngines(node.id, signal);
      nodeEngines.set(node.id, result.items);
      for (const summary of result.items) {
        if (summary.ownership === 'managed')
          engines.push({ node, engine: await getEngine(summary.id, signal) });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        restricted++;
        continue;
      }
      throw error;
    }
  }

  const relaysByLanding = new Map<string, RelayRoute[]>();
  const managedRelayIds = new Set<string>();
  for (const route of relayResult.items) {
    managedRelayIds.add(route.id);
    if (!route.cleanup_only && route.draft.landing_engine_id && route.draft.landing_service_id) {
      const key = `${route.draft.landing_engine_id}/${route.draft.landing_service_id}`;
      const list = relaysByLanding.get(key) ?? [];
      list.push(route);
      relaysByLanding.set(key, list);
    }
  }

  const presets = new Map<string, { protocol: string; name: string }>();
  const rows: ServiceRow[] = [];
  let managedRelayCount = 0;

  for (const { node, engine } of engines) {
    const changes = engineDraftChanges(engine.draft, engine.published_draft);
    for (const service of engine.draft.services) {
      // Managed Realm relay rules live in「中转线路」and appear attached under their landing services.
      if (engine.name === 'realm' && relayResult.loaded && managedRelayIds.has(service.id)) {
        managedRelayCount++;
        continue;
      }
      let protocol = engine.name === 'realm' ? 'TCP 转发' : 'VLESS / TCP / REALITY';
      let presetName = '';
      if (service.preset_id) {
        if (!presets.has(service.preset_id)) {
          try {
            const { config } = await getProtocolPreset(service.preset_id, signal);
            presets.set(service.preset_id, {
              protocol:
                `${config.protocol} / ${config.transport} / ${config.security}`.toUpperCase(),
              name: config.name,
            });
          } catch (error) {
            if (error instanceof ApiError && [403, 404].includes(error.status ?? 0))
              presets.set(service.preset_id, {
                protocol: '协议信息不可读取',
                name: service.preset_id,
              });
            else throw error;
          }
        }
        const resolved = presets.get(service.preset_id);
        protocol = resolved?.protocol ?? '未知';
        presetName = resolved?.name ?? service.preset_id;
      }
      const hasDraftChanges = changes.some((change) => change.id === service.id);
      const configuration = service.pending_delete
        ? '待删除'
        : hasDraftChanges
          ? '草稿未发布'
          : engine.sync_state === 'failed'
            ? '应用失败'
            : engine.sync_state === 'syncing' || engine.desired_revision > engine.observed_revision
              ? '待同步'
              : engine.published_draft
                ? '已同步'
                : '未发布';
      const id = `${engine.id}/${service.id}`;
      rows.push({
        id,
        name: service.name,
        node,
        engine,
        service,
        protocol,
        presetName,
        hasDraftChanges,
        endpoint: endpoint(service.public_host, service.public_port),
        runtime: serviceRuntime(engine, service, node.state === 'online'),
        configuration,
        relays: engine.name === 'realm' ? [] : (relaysByLanding.get(id) ?? []),
        relayEligible: engine.name !== 'realm' && hasPublishedRelayLanding(engine, service.id),
      });
    }
  }
  return {
    nodes,
    engines,
    nodeEngines,
    rows,
    restricted,
    relaysLoaded: relayResult.loaded,
    managedRelayCount,
  };
}
