import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { type NodeRecord, nodeState } from '@/api/nodes';
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
    <span
      className={`inline-flex items-center gap-2 font-normal ${statusColors[node.state] ?? 'text-text-secondary'}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {nodeState(node.state)}
    </span>
  );
  if (node.state !== 'pending' || session.user.role !== 'admin') return label;

  return (
    <NodeInstallDialog node={node} trigger={<span className="cursor-pointer">{label}</span>} />
  );
}
