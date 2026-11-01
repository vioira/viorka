import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { type NodeRecord, nodeState } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { NodeInstallDialog } from '@/components/enrollment/NodeInstallDialog';

const statusColors: Record<string, string> = {
  online: 'text-success',
  offline: 'text-danger',
  pending: 'text-warning',
  disabled: 'text-text-secondary',
};

export default function NodeConnectionStatus({ node }: { node: NodeRecord }) {
  const session = useOutletContext<Session>();
  const label = (
    <span className={statusColors[node.state] ?? 'text-text-secondary'}>
      {nodeState(node.state)}
    </span>
  );
  if (node.state !== 'pending' || session.user.role !== 'admin') return label;

  return (
    <NodeInstallDialog
      node={node}
      trigger={
        <Button
          variant="ghost"
          className="min-h-11 underline decoration-dotted underline-offset-4"
          aria-label={`${node.name || node.id}：待注册，安装 Agent`}
        >
          {label}
        </Button>
      }
    />
  );
}
