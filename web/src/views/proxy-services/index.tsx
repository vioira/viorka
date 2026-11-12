import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { type Connection, engineConnections, engineNames } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { SearchField } from '@/components/arc/search-field/search-field';
import { Select } from '@/components/arc/select/select';
import DataTable, { type DataColumn } from '@/components/data-table';
import EngineConnectionsDialog from '@/components/engine-connections';
import { NodeStatusLink, StatusIndicator } from '@/components/node-status';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import { endpoint, loadServices, type ServiceRow } from './service-data';

const serviceStatusColors: Record<string, string> = {
  运行中: 'text-success',
  已同步: 'text-success',
  异常: 'text-danger',
  应用失败: 'text-danger',
  草稿未发布: 'text-warning',
  未发布: 'text-warning',
  待同步: 'text-warning',
  待删除: 'text-warning',
  已停止: 'text-text-secondary',
  未知: 'text-text-secondary',
};

function ServiceStatus({ value }: { value: string }) {
  return (
    <StatusIndicator text={value} className={serviceStatusColors[value] ?? 'text-text-secondary'} />
  );
}

export default function ProxyServicesPage() {
  const navigate = useNavigate();
  const session = useOutletContext<Session>();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadServices>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [, report] = useToastFeedback('error');
  const [query, setQuery] = useState('');
  const [node, setNode] = useState('all');
  const [engine, setEngine] = useState('all');
  const [runtime, setRuntime] = useState('all');
  const [selected, setSelected] = useState<ServiceRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState('');
  const [targetEngine, setTargetEngine] = useState('sing-box');
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [connectionNode, setConnectionNode] = useState('');
  const [revealing, setRevealing] = useState(false);
  const connectionFocus = useRef<HTMLElement | null>(null);
  const connectionRequest = useRef(0);
  useEffect(
    () => () => {
      connectionRequest.current++;
    },
    [],
  );
  async function reveal(row: ServiceRow) {
    const request = ++connectionRequest.current;
    connectionFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRevealing(true);
    report('');
    try {
      const result = await engineConnections(row.engine.id, session);
      if (request !== connectionRequest.current) return;
      setConnectionNode(row.node.id);
      setConnections(result.filter((item) => item.service_id === row.service.id));
    } catch (error) {
      if (request === connectionRequest.current)
        report(error instanceof Error ? error.message : '无法读取连接信息，请刷新重试');
    } finally {
      if (request === connectionRequest.current) setRevealing(false);
    }
  }
  const focus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    void reload;
    const controller = new AbortController();
    setLoading(true);
    report('');
    loadServices(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          report(error instanceof Error ? error.message : '无法读取代理服务，请刷新重试');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, report]);
  const search = query.trim().toLocaleLowerCase();
  const rows = (data?.rows ?? []).filter(
    (row) =>
      (node === 'all' || row.node.id === node) &&
      (engine === 'all' || row.engine.name === engine) &&
      (runtime === 'all' || row.runtime === runtime) &&
      `${row.name} ${row.service.id} ${row.node.name} ${row.endpoint}`
        .toLocaleLowerCase()
        .includes(search),
  );
  function open(row: ServiceRow) {
    focus.current = document.activeElement as HTMLElement;
    setSelected(row);
  }
  const columns: DataColumn<ServiceRow>[] = [
    {
      key: 'name',
      label: '服务',
      render: (_, row) => (
        <div className="max-w-56 wrap-anywhere">
          <Link
            to={`/nodes/${encodeURIComponent(row.node.id)}?tab=engines&engine=${row.engine.name}`}
            className="inline-flex items-center font-medium text-success hover:underline wrap-anywhere"
          >
            {row.name}
          </Link>
        </div>
      ),
    },
    { key: 'protocol', label: '协议' },
    {
      key: 'node',
      label: '所属节点',
      sortable: false,
      render: (_, row) => (
        <div className="max-w-48 wrap-anywhere">
          <NodeStatusLink
            id={row.node.id}
            name={row.node.name}
            state={row.node.state}
            lastSeenAt={row.node.last_seen_at}
          />
        </div>
      ),
    },
    { key: 'engine', label: '引擎', sortable: false, render: (_, row) => row.engine.name },
    {
      key: 'endpoint',
      label: '接入地址',
      render: (_, row) => <span className="tabular-nums wrap-anywhere">{row.endpoint}</span>,
    },
    {
      key: 'runtime',
      label: '运行状态',
      render: (_, row) => <ServiceStatus value={row.runtime} />,
    },
    {
      key: 'configuration',
      label: '配置状态',
      render: (_, row) => <ServiceStatus value={row.configuration} />,
    },
    {
      key: 'action',
      label: '操作',
      sortable: false,
      render: (_, row) => (
        <div className="flex items-center gap-2">
          {row.engine.name !== 'realm' && (
            <Button
              variant="ghost"
              disabled={
                revealing ||
                row.node.state !== 'online' ||
                row.runtime !== '运行中' ||
                row.service.pending_delete
              }
              onClick={() => void reveal(row)}
            >
              连接
            </Button>
          )}
          <Button variant="ghost" onClick={() => open(row)}>
            查看服务
          </Button>
        </div>
      ),
    },
  ];
  const options = [
    { value: 'all', label: '全部节点' },
    ...(data?.nodes ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];
  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid min-w-0 flex-1 basis-full grid-cols-1 gap-3 sm:grid-cols-2 lg:basis-128 lg:grid-cols-4">
            <SearchField
              hideLabel
              label="搜索服务"
              placeholder="服务名、节点名或接入地址"
              value={query}
              onValueChange={setQuery}
            />
            <Select hideLabel label="节点" value={node} onValueChange={setNode} options={options} />
            <Select
              hideLabel
              label="引擎"
              value={engine}
              onValueChange={setEngine}
              options={[
                { value: 'all', label: '全部引擎' },
                ...engineNames.map((value) => ({ value, label: value })),
              ]}
            />
            <Select
              hideLabel
              label="运行状态"
              value={runtime}
              onValueChange={setRuntime}
              options={[
                { value: 'all', label: '全部状态' },
                ...['运行中', '已停止', '未发布', '异常', '未知'].map((value) => ({
                  value,
                  label: value,
                })),
              ]}
            />
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => setReload((value) => value + 1)}
            >
              {loading ? '正在读取…' : '刷新服务'}
            </Button>
            <Button
              disabled={!data || session.user.role === 'viewer'}
              onClick={() => {
                focus.current = document.activeElement as HTMLElement;
                setAdding(true);
              }}
            >
              添加服务
            </Button>
          </div>
        </div>
        <p role="status" className="text-(length:--text-xs) text-text-secondary tabular-nums">
          {data ? `${rows.length} 个匹配服务 / 共 ${data.rows.length} 个` : '服务数量未知'}
          {data?.restricted ? `，${data.restricted} 个节点无查看权限` : ''}
        </p>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey="id"
        caption="代理服务"
        loading={!data && loading}
        emptyMessage={
          !data
            ? '尚未读取服务'
            : data.rows.length
              ? '没有匹配的服务，请调整筛选'
              : '暂无可查看的服务'
        }
      />
      <EngineConnectionsDialog
        connections={connections}
        online={data?.nodes.find((item) => item.id === connectionNode)?.state === 'online'}
        onClose={() => setConnections(null)}
        returnFocus={connectionFocus.current}
      />
      <Drawer
        open={!!selected || adding}
        onOpenChange={(value) => {
          if (!value) {
            setSelected(null);
            setAdding(false);
          }
        }}
      >
        <DrawerContent
          title={adding ? '添加服务' : (selected?.name ?? '服务详情')}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focus.current?.focus();
          }}
        >
          {adding ? (
            <div className="space-y-6">
              <Select
                label="所属节点"
                value={target}
                onValueChange={setTarget}
                options={options.slice(1)}
                placeholder="选择节点"
              />
              <Select
                label="引擎"
                value={targetEngine}
                onValueChange={setTargetEngine}
                options={engineNames.map((value) => ({ value, label: value }))}
              />
              <p className="text-text-secondary">
                在节点中填写服务配置、保存草稿并发布。尚未安装的引擎需先安装。
              </p>
              <Button
                disabled={!target}
                onClick={() =>
                  navigate(
                    `/nodes/${encodeURIComponent(target)}?tab=engines&engine=${targetEngine}&create=1`,
                  )
                }
              >
                继续配置
              </Button>
            </div>
          ) : (
            selected && (
              <div className="space-y-6">
                <dl className="space-y-4">
                  {Object.entries({
                    所属节点: selected.node.name,
                    引擎: selected.engine.name,
                    协议: selected.protocol,
                    运行状态: selected.runtime,
                    配置状态: selected.configuration,
                    '公网入口（草稿）': selected.endpoint,
                    '监听地址（草稿）': endpoint(
                      selected.service.listen_host,
                      selected.service.listen_port,
                    ),
                    '目标地址（草稿）': endpoint(
                      selected.service.target_host,
                      selected.service.target_port,
                    ),
                    协议预设: selected.service.preset_id || '未引用',
                    草稿版本: String(selected.engine.draft.version),
                    已发布版本: String(selected.engine.published_revision),
                    已观测版本: String(selected.engine.observed_revision),
                  }).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-(length:--text-xs) text-text-secondary">{label}</dt>
                      <dd className="mt-1 wrap-anywhere">
                        {label === '运行状态' || label === '配置状态' ? (
                          <ServiceStatus value={value} />
                        ) : (
                          value
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-(length:--text-xs) text-text-secondary">
                  运行状态依据已发布配置与引擎上报，不含外部连通性验证。草稿地址在发布后生效。
                </p>
                <Button
                  onClick={() =>
                    navigate(
                      `/nodes/${encodeURIComponent(selected.node.id)}?tab=engines&engine=${selected.engine.name}`,
                    )
                  }
                >
                  管理服务配置
                </Button>
              </div>
            )
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
