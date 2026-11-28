import { ArrowRight, Eye, Pencil, Plus, Send } from 'lucide-react';
import { Link } from 'react-router';
import type { RelayRoute } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import DataTable, { type DataColumn } from '@/components/data-table';
import {
  endpointText,
  isNatMapped,
  needsRelayPublication,
  proxyServicePath,
  relayStatusLabel,
  relayTone,
} from '@/components/proxy/relay-meta';

type RealmRelayRow = {
  id: string;
  name: string;
  route: RelayRoute;
};

export default function RealmRelayTable({
  routes,
  loaded,
  loading,
  canManage,
  disabled,
  onCreate,
  onInspect,
  onEdit,
  onPublish,
}: {
  routes: RelayRoute[];
  loaded: boolean;
  loading: boolean;
  canManage: boolean;
  disabled: boolean;
  onCreate: (trigger: HTMLElement | null) => void;
  onInspect: (route: RelayRoute, trigger: HTMLElement | null) => void;
  onEdit: (route: RelayRoute, trigger: HTMLElement | null) => void;
  onPublish: (route: RelayRoute, trigger: HTMLElement | null) => void;
}) {
  const rows: RealmRelayRow[] = routes.map((route) => ({
    id: route.id,
    name: route.draft.name,
    route,
  }));

  const columns: DataColumn<RealmRelayRow>[] = [
    {
      key: 'name',
      label: '中转线路',
      render: (_, { route: r }) => (
        <div className="min-w-0 space-y-1 wrap-anywhere">
          <button
            type="button"
            onClick={(e) => onInspect(r, e.currentTarget)}
            className="text-left font-medium text-foreground hover:text-accent hover:underline wrap-anywhere"
          >
            {r.draft.name}
          </button>
          {r.published && r.published.version !== r.draft.version && (
            <div>
              <Badge size="sm" tone="warning">
                草稿待发布
              </Badge>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'endpoint',
      label: '公网入口与监听',
      sortable: false,
      render: (_, { route: r }) => {
        const path = r.serving_path ?? r.published ?? r.draft;
        const nat = isNatMapped(path);
        return (
          <div className="space-y-1 font-mono text-(length:--text-xs) tabular-nums">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-foreground wrap-anywhere">
                {endpointText(path.public)}
              </span>
              {nat && (
                <Badge size="sm" tone="info">
                  NAT
                </Badge>
              )}
            </div>
            <p className="text-text-secondary wrap-anywhere">监听 {endpointText(path.listen)}</p>
          </div>
        );
      },
    },
    {
      key: 'landing',
      label: '转发落地',
      sortable: false,
      render: (_, { route: r }) => {
        const path = r.serving_path ?? r.published ?? r.draft;
        return (
          <div className="space-y-1 text-(length:--text-xs)">
            {r.cleanup_only ? (
              <span className="font-medium text-danger">落地导出权限已撤销</span>
            ) : (
              <>
                <Link
                  to={proxyServicePath(path.landing_engine_id, path.landing_service_id)}
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline wrap-anywhere"
                >
                  <ArrowRight size={12} strokeWidth={1.75} aria-hidden="true" />
                  <span>{path.landing_name || '落地服务'}</span>
                </Link>
                <p className="font-mono text-text-secondary tabular-nums wrap-anywhere">
                  拨号 {endpointText(path.dial)}
                </p>
              </>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: '订阅状态',
      sortable: false,
      render: (_, { route: r }) => (
        <Badge size="sm" dot tone={relayTone(r)}>
          {relayStatusLabel(r)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: '操作',
      sortable: false,
      render: (_, { route: r }) => {
        const canPublish =
          canManage &&
          r.can_manage &&
          !r.cleanup_only &&
          r.reason !== 'landing_changed' &&
          needsRelayPublication(r) &&
          Boolean(r.publish_base);
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {canPublish && (
              <Button size="sm" variant="secondary" onClick={(e) => onPublish(r, e.currentTarget)}>
                <Send size={14} strokeWidth={1.75} aria-hidden="true" />
                发布
              </Button>
            )}
            {canManage && r.can_manage && !r.cleanup_only && (
              <Button size="sm" variant="ghost" onClick={(e) => onEdit(r, e.currentTarget)}>
                <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                编辑
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={(e) => onInspect(r, e.currentTarget)}>
              <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
              诊断
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      loaded={loaded}
      loading={loading}
      rows={rows}
      columns={columns}
      rowKey="id"
      caption="托管中转线路"
      emptyMessage="此 Realm 实例尚无托管中转线路"
      emptyState={{
        variant: 'unconfigured',
        headingLevel: 3,
        description:
          '托管中转线路自动关联落地服务、执行发布校验与公网探测，验证通过后可直接选入订阅。',
        action:
          canManage && !disabled ? (
            <Button onClick={(e) => onCreate(e.currentTarget)}>
              <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
              创建中转线路
            </Button>
          ) : undefined,
      }}
    />
  );
}
