import { Copy } from 'lucide-react';
import { useState } from 'react';
import QRCode from 'react-qr-code';
import type { SubscriptionIssued } from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useDialogFocus } from './useDialogFocus';

const importHelp: Record<string, string> = {
  auto: '在客户端添加远程配置并粘贴链接。若无法识别客户端，请切换为上方对应格式。',
  mihomo: '在 Mihomo / Clash 客户端新建远程配置，粘贴此链接并更新配置。',
  'sing-box': '在 sing-box 客户端新建远程配置文件，填入此 URL 后保存并更新。',
  loon: '在 Loon 中添加远程配置（非远程节点订阅），将此链接填入配置 URL。',
};

export default function IssuedDialog({
  issued,
  onClose,
  returnFocus,
}: {
  issued: SubscriptionIssued;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const { toast } = useToastStack();
  const dialogFocus = useDialogFocus(returnFocus);
  const [format, setFormat] = useState('auto');

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ type: 'success', title: '订阅链接已复制' });
    } catch {
      toast({
        id: 'subscription-copy',
        type: 'error',
        title: '未能复制订阅链接',
        description: '请选择链接并手动复制。',
      });
    }
  }

  const links = [
    { value: 'auto', label: '自动识别', url: issued.url },
    ...Object.entries(issued.format_urls).map(([key, url]) => ({
      value: key,
      label: key === 'loon' ? 'Loon' : key === 'mihomo' ? 'Mihomo' : 'sing-box',
      url: url ?? '',
    })),
  ];
  const link = links.find((entry) => entry.value === format) ?? links[0];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        {...dialogFocus}
        data-subscription-management
        title={`保存“${issued.subscription.name}”的链接`}
        description="完整链接仅本次显示，关闭前请复制保存。"
        className="[--dialog-width:680px]"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              完成
            </Button>
            <Button onClick={() => void copy(link.url)}>
              <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
              复制链接
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-(length:--text-xs) text-text-secondary">
              导入格式（共用同一访问凭证）
            </p>
            <SegmentedControl
              label="导入格式"
              value={format}
              onValueChange={setFormat}
              options={links.map(({ value, label }) => ({ value, label }))}
            />
          </div>

          <div className="flex flex-col items-start gap-5 sm:flex-row">
            <div className="min-w-0 flex-1 space-y-3 w-full">
              <Input
                label="订阅链接"
                value={link.url}
                readOnly
                className="font-mono text-(length:--text-xs)"
                onFocus={(event) => event.currentTarget.select()}
              />
              <p className="text-(length:--text-sm)">{importHelp[link.value]}</p>
              <p className="text-(length:--text-xs) text-text-secondary">
                链接包含访问凭证。轮换或吊销后，旧链接立即停止更新，但已下载的节点配置仍可能使用。
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-center gap-2 self-center sm:self-start">
              <div className="rounded-(--radius-control) border-[1px] border-border bg-white p-3">
                <QRCode
                  value={link.url}
                  size={148}
                  className="block h-auto w-full"
                  role="img"
                  aria-label="当前订阅链接二维码"
                />
              </div>
              <span className="text-(length:--text-xs) text-text-secondary">本地生成二维码</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
