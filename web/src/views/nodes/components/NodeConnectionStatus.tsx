import { type NodeRecord, nodeState } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { InstallInstructions } from '@/components/enrollment/InstallInstructions';

const statusColors: Record<string, string> = {
  online: 'text-success',
  offline: 'text-danger',
  pending: 'text-warning',
  disabled: 'text-text-secondary',
};

export default function NodeConnectionStatus({ node }: { node: NodeRecord }) {
  const label = (
    <span className={statusColors[node.state] ?? 'text-text-secondary'}>
      {nodeState(node.state)}
    </span>
  );
  if (node.state !== 'pending') return label;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="inline-flex min-h-11 cursor-pointer items-center underline decoration-dotted underline-offset-4"
          aria-label={`${node.name}：待注册，查看安装说明`}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
        >
          {label}
        </span>
      </DialogTrigger>
      <DialogContent
        title="安装说明"
        description="将 Agent 安装到此节点，完成注册后启动连接。"
        className="[--dialog-width:720px]"
      >
        <div className="min-w-0 space-y-5">
          <p className="break-all text-text-secondary">
            {node.name} / {node.id}
          </p>
          <p className="text-(length:--text-xs) text-text-secondary">
            注册令牌仅在添加节点时显示，关闭后无法找回。请使用当时保存的令牌，令牌有效期为 15
            分钟。当前不支持为已有节点补发令牌；若令牌遗失或过期，请联系管理员处理。
          </p>
          <InstallInstructions />
          <div className="flex justify-end">
            <DialogClose asChild>
              <Button variant="secondary">关闭说明</Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
