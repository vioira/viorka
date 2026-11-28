import type { ServiceItem } from '@/api/proxy-services';

export const endpoint = (host: string, port: number) =>
  host && port ? `${host.includes(':') ? `[${host}]` : host}:${port}` : '未配置';

const runtimeLabels = {
  unknown: '未知',
  running: '运行中',
  degraded: '异常',
  stopped: '已停止',
  unpublished: '未发布',
};
const configLabels = {
  pending_delete: '待删除',
  draft: '草稿未发布',
  failed: '应用失败',
  pending: '待同步',
  synced: '已同步',
  unpublished: '未发布',
};

export function serviceRow(item: ServiceItem) {
  return {
    ...item,
    name: item.service.name,
    endpoint: endpoint(item.service.public_host, item.service.public_port),
    runtime: runtimeLabels[item.runtime],
    configuration: configLabels[item.configuration],
  };
}
export type ServiceRow = ReturnType<typeof serviceRow>;
