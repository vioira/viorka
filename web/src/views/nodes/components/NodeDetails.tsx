import { useState } from 'react';
import { type NodeRecord, nodeKind, nodeState, nodeTime } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from '@/components/arc/drawer/drawer';
import NodeMonitoring from './NodeMonitoring';
import NodeSettings from './NodeSettings';

export default function NodeDetails({ node }: { node: NodeRecord }) {
  const offline = node.state !== 'online';
  const [open, setOpen] = useState(false);
  const groups = [
    {
      title: '资产信息',
      fields: [
        ['节点 ID', node.id],
        ['节点类型', nodeKind(node.kind)],
        ['系统', node.inventory?.os_name || node.os || '尚未上报'],
        ['发行版', node.inventory?.os_id || '未知'],
        ['系统版本', node.inventory?.os_version || '未知'],
        ['资产采集时间', nodeTime(node.inventory?.sampled_at ?? '')],
        ['架构', node.arch || '尚未上报'],
        ['Agent 版本', node.agent_version || '尚未上报'],
      ],
    },
    {
      title: '网络与配置',
      fields: [
        [
          '公网 IPv4（出口）',
          node.inventory?.public_ipv4 || (node.inventory ? '未知' : '尚未上报'),
        ],
        [
          '公网 IPv6（出口）',
          node.inventory?.public_ipv6 || (node.inventory ? '未知' : '尚未上报'),
        ],
        ['代理引擎', '尚未提供'],
        ['配置修订', '尚未提供'],
      ],
    },
  ];
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="ghost" className="min-h-11">
          {node.name || node.id}
          <span className="sr-only">，查看节点详情</span>
        </Button>
      </DrawerTrigger>
      <DrawerContent title={node.name || node.id} description="节点资产与实时主机监控">
        <div className="space-y-6">
          <section aria-label="连接状态" className="space-y-3">
            <h3 className={`font-medium ${offline ? 'text-text-secondary' : 'text-success'}`}>
              {nodeState(node.state)}
            </h3>
            <p className="text-text-secondary">
              {node.state === 'online'
                ? 'Agent 已连接面板。'
                : '当前未确认 Agent 在线，已有代理服务的运行状态需另行确认。'}
            </p>
            <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
              最后在线：{nodeTime(node.last_seen_at)}
            </p>
          </section>
          <NodeMonitoring key={node.id} id={node.id} active={open} />
          {groups.map(({ title, fields }) => (
            <section key={title} aria-label={title} className="border-t-[0.5px] border-border pt-6">
              <h3 className="mb-4 font-medium">{title}</h3>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {fields.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-(length:--text-xs) text-text-secondary">{label}</dt>
                    <dd className="mt-1 wrap-anywhere tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {open && <NodeSettings key={node.id} id={node.id} />}
          <div className="flex justify-end border-t-[0.5px] border-border pt-4">
            <DrawerClose asChild>
              <Button variant="secondary">关闭详情</Button>
            </DrawerClose>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
