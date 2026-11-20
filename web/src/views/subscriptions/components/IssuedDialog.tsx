import { Copy } from 'lucide-react';
import { useState } from 'react';
import QRCode from 'react-qr-code';
import type { SubscriptionIssued } from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useDialogFocus } from './useDialogFocus';

const importHelp: Record<string, string> = {
  auto: '在客户端添加远程配置并粘贴链接。若无法识别客户端，可在上方选择对应格式。',
  mihomo: '在使用 Mihomo 的客户端添加远程配置，粘贴此链接并更新配置。',
  'sing-box': '在 sing-box 客户端新建远程配置文件，填入此 URL 后保存并更新。',
  loon: '在 Loon 中添加远程配置，将此链接填入配置 URL。',
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
  const [showQR, setShowQR] = useState(false);
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
    { value: 'auto', label: '自动识别客户端', url: issued.url },
    ...Object.entries(issued.format_urls).map(([key, url]) => ({
      value: key,
      label: key === 'loon' ? 'Loon 远程配置' : key === 'mihomo' ? 'Mihomo YAML' : 'sing-box JSON',
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
        description="完整链接仅在本次显示，关闭前请复制保存。"
        className="[--dialog-width:640px]"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              完成
            </Button>
            <Button onClick={() => void copy(link.url)}>
              <Copy size={16} aria-hidden="true" />
              复制链接
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Select
            label="导入方式"
            value={format}
            onValueChange={setFormat}
            options={links.map(({ value, label }) => ({ value, label }))}
          />
          <Input
            label="订阅链接"
            value={link.url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="text-sm">{importHelp[link.value]}</p>
          <Button variant="secondary" aria-expanded={showQR} onClick={() => setShowQR(!showQR)}>
            {showQR ? '收起二维码' : '显示二维码'}
          </Button>
          {showQR && (
            <div className="mx-auto w-56 max-w-full bg-white p-5">
              <QRCode
                value={link.url}
                size={184}
                className="block h-auto w-full"
                role="img"
                aria-label="当前订阅链接二维码"
              />
            </div>
          )}
          <p className="text-sm text-(--text-secondary)">
            链接包含访问凭证。轮换或吊销后，旧链接停止更新，已下载的节点配置仍可能使用。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
