import type { ReactNode } from 'react';
import QRCode from 'react-qr-code';
import { type Connection, engineStatus } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export default function EngineConnectionsDialog({
  connections,
  online,
  onClose,
  returnFocus,
  renderActions,
}: {
  connections: Connection[] | null;
  online: boolean;
  onClose: () => void;
  returnFocus: HTMLElement | null;
  renderActions?: (connection: Connection) => ReactNode;
}) {
  const { toast } = useToastStack();
  return (
    <Dialog
      open={connections !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="已应用连接信息"
        description="仅展示已应用版本，草稿修改不影响这些参数。包含客户端凭证，请妥善保管；外部连通尚未验证。"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus?.focus();
        }}
      >
        {connections?.length === 0 ? (
          <p>所选服务尚无已应用的连接信息，或未登记对外入口。</p>
        ) : (
          connections?.map((item) => (
            <div key={item.service_id} className="space-y-3 border-b-[1px] border-border pb-4">
              <Input
                label={`${item.name} / 修订 ${item.revision}`}
                value={item.url}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="w-fit max-w-full bg-white p-4">
                <QRCode value={item.url} size={192} title={`${item.name} 客户端连接二维码`} />
              </div>
              <p className="text-text-secondary">
                {online ? engineStatus(item.runtime_status) : '节点离线，运行状态未确认'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="min-h-9"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(item.url);
                      toast({
                        id: 'engine-connection-copy',
                        type: 'success',
                        title: '连接链接已复制',
                      });
                    } catch {
                      toast({
                        id: 'engine-connection-copy',
                        type: 'error',
                        title: '无法复制链接',
                        description: '请选中连接链接后手动复制。',
                      });
                    }
                  }}
                >
                  复制链接
                </Button>
                {renderActions?.(item)}
              </div>
            </div>
          ))
        )}
      </DialogContent>
    </Dialog>
  );
}
