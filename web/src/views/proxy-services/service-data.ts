import { ApiError } from '@/api/client';
import { type EngineRecord, type EngineService, getEngine, listEngines } from '@/api/engines';
import { listAllNodes, type NodeRecord } from '@/api/nodes';
import { getProtocolPreset } from '@/api/protocol-presets';
import { engineDraftChanges } from '../node-details/components/engine-draft-diff';

export type ServiceRow = {
  id: string;
  name: string;
  node: NodeRecord;
  engine: EngineRecord;
  service: EngineService;
  protocol: string;
  endpoint: string;
  runtime: string;
  configuration: string;
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

export async function loadServices(signal: AbortSignal) {
  const nodes = await listAllNodes(signal);
  const engines: { node: NodeRecord; engine: EngineRecord }[] = [];
  let restricted = 0;
  // Bound requests to one node/engine at a time instead of fanning out across the fleet.
  for (const node of nodes) {
    try {
      const result = await listEngines(node.id, signal);
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
  const presets = new Map<string, string>();
  const rows: ServiceRow[] = [];
  for (const { node, engine } of engines) {
    const changes = engineDraftChanges(engine.draft, engine.published_draft);
    for (const service of engine.draft.services) {
      let protocol = engine.name === 'realm' ? 'TCP 转发' : 'VLESS / TCP / REALITY';
      if (service.preset_id) {
        if (!presets.has(service.preset_id)) {
          try {
            const { config } = await getProtocolPreset(service.preset_id, signal);
            presets.set(
              service.preset_id,
              `${config.protocol} / ${config.transport} / ${config.security}`.toUpperCase(),
            );
          } catch (error) {
            if (error instanceof ApiError && [403, 404].includes(error.status ?? 0))
              presets.set(service.preset_id, '协议信息不可读取');
            else throw error;
          }
        }
        protocol = presets.get(service.preset_id) ?? '未知';
      }
      const configuration = service.pending_delete
        ? '待删除'
        : changes.some((change) => change.id === service.id)
          ? '草稿未发布'
          : engine.sync_state === 'failed'
            ? '应用失败'
            : engine.sync_state === 'syncing' || engine.desired_revision > engine.observed_revision
              ? '待同步'
              : engine.published_draft
                ? '已同步'
                : '未发布';
      rows.push({
        id: `${engine.id}/${service.id}`,
        name: service.name,
        node,
        engine,
        service,
        protocol,
        endpoint: endpoint(service.public_host, service.public_port),
        runtime: serviceRuntime(engine, service, node.state === 'online'),
        configuration,
      });
    }
  }
  return { nodes, engines, rows, restricted };
}
