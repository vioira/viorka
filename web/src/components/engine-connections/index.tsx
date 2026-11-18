import { Copy, QrCode } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { type Connection, engineStatus } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EmptyStates from '@/components/empty-states';

function ConnectionDetails({
  connection,
  online,
  actions,
}: {
  connection: Connection;
  online: boolean;
  actions?: ReactNode;
}) {
  const { toast } = useToastStack();
  const [showQr, setShowQr] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const qrId = useId();

  async function copyLink(button: HTMLButtonElement) {
    try {
      await navigator.clipboard.writeText(connection.url);
      toast({
        id: 'engine-connection-copy',
        type: 'success',
        title: '连接链接已复制',
      });
    } catch {
      if (document.activeElement === button) {
        linkRef.current?.focus();
        linkRef.current?.select();
      }
      toast({
        id: 'engine-connection-copy',
        type: 'error',
        title: '无法复制链接',
        description: '请选择连接链接并手动复制。',
      });
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="grid min-w-0 gap-4 [&+section]:border-t [&+section]:border-border [&+section]:pt-4"
    >
      <header className="min-w-0 space-y-1">
        <h3 id={headingId} className="font-medium text-foreground wrap-anywhere">
          {connection.name}
        </h3>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-(length:--text-xs) text-text-secondary">
          <span className="tabular-nums">修订 {connection.revision}</span>
          <span role="status">
            {online ? engineStatus(connection.runtime_status) : '节点离线，运行状态未确认'}
          </span>
        </div>
      </header>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <Input
          ref={linkRef}
          label="连接链接"
          value={connection.url}
          readOnly
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button type="button" onClick={(event) => void copyLink(event.currentTarget)}>
          <Copy size={16} aria-hidden="true" />
          复制链接
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          aria-expanded={showQr}
          aria-controls={qrId}
          onClick={() => setShowQr((visible) => !visible)}
        >
          <QrCode size={16} aria-hidden="true" />
          {showQr ? '收起二维码' : '显示二维码'}
        </Button>
        {actions}
      </div>
      <div id={qrId} hidden={!showQr}>
        {showQr && (
          <figure className="grid justify-items-center gap-2">
            {/* A white quiet zone is part of the scannable image in both themes. */}
            <div className="w-56 max-w-full bg-white p-5">
              <QRCode
                className="block h-auto w-full"
                value={connection.url}
                size={184}
                role="img"
                aria-label={`${connection.name} 的连接二维码`}
              />
            </div>
            <figcaption className="text-(length:--text-xs) text-text-secondary">
              使用代理客户端扫码导入
            </figcaption>
          </figure>
        )}
      </div>
    </section>
  );
}

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
  return (
    <Dialog
      open={connections !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="已应用连接信息"
        description="链接和二维码均含客户端凭证，请妥善保管。外部连通尚未验证。"
        className="[--dialog-width:560px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus?.focus();
        }}
      >
        {connections?.length === 0 ? (
          <EmptyStates
            variant="unconfigured"
            title="暂无连接信息"
            description="所选服务尚无已应用版本，或未登记对外入口。"
          />
        ) : (
          <div className="grid gap-4">
            {connections?.map((item) => (
              <ConnectionDetails
                key={item.service_id}
                connection={item}
                online={online}
                actions={renderActions?.(item)}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
