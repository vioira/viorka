import { useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  newOutbound,
  type Outbound,
  type OutboundConfig,
  type OutboundPreview,
  parseOutbound,
  previewOutbound,
  saveOutbound,
} from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import { PasswordField } from '@/components/arc/password-field/password-field';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { ClientFingerprintSelect } from '@/components/ClientFingerprintSelect';
export default function OutboundEditor({
  outbound,
  session,
  onClose,
  onSaved,
  returnFocus,
}: {
  outbound: Outbound | null;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
  returnFocus?: () => void;
}) {
  const [config, setConfig] = useState<OutboundConfig>(outbound?.config ?? newOutbound());
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [preview, setPreview] = useState<OutboundPreview | null>(null);
  const { toast } = useToastStack();
  const trigger = useRef<HTMLElement | null>(null);
  function change(p: Partial<OutboundConfig>) {
    setConfig((c) => ({ ...c, ...p }));
    setPreview(null);
  }
  async function action(run: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await run();
    } catch (e) {
      toast({
        id: 'outbound-edit',
        type: 'error',
        title: '未能完成出口配置',
        description: e instanceof Error ? e.message : '请检查参数后重试。',
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(confirmation = '') {
    await saveOutbound(outbound, config, confirmation, session);
    toast({
      type: 'success',
      title: '出口配置已保存',
      description: outbound ? '已发布的引用节点将同步最新配置。' : '可在节点的出口标签中添加引用。',
    });
    onSaved();
  }
  const text = (key: keyof OutboundConfig, label: string, maxLength = 253) => (
    <Input
      label={label}
      maxLength={maxLength}
      value={String(config[key] ?? '')}
      onChange={(e) => change({ [key]: e.target.value })}
    />
  );
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DrawerContent
        title={outbound ? '编辑出口配置' : '添加出口配置'}
        description="节点仅引用此配置，不支持节点级参数覆盖。"
        onOpenAutoFocus={() => {
          trigger.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (returnFocus) returnFocus();
          else trigger.current?.focus();
        }}
      >
        <div className="space-y-6">
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <PasswordField
              label="粘贴 VLESS 链接"
              value={link}
              maxLength={8192}
              autoComplete="off"
              onChange={(e) => setLink(e.target.value)}
              description="支持 TCP（无 TLS 或 REALITY）。解析只填入表单，不会保存或发布。"
              messages={{ showPassword: '显示链接', hidePassword: '隐藏链接' }}
            />
            <Button
              variant="secondary"
              disabled={!link.trim()}
              onClick={() =>
                action(async () => {
                  setConfig(await parseOutbound(link, session));
                  setLink('');
                  setPreview(null);
                  toast({
                    type: 'success',
                    title: '链接已解析',
                    description: '请检查参数后保存出口。',
                  });
                })
              }
            >
              解析链接
            </Button>
          </fieldset>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                if (outbound) setPreview(await previewOutbound(outbound, config, session));
                else await save();
              });
            }}
          >
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              {text('name', '出口名称', 128)}
              <Select
                label="出口协议"
                value={config.type}
                options={[
                  { value: 'vless', label: 'VLESS TCP' },
                  { value: 'socks', label: 'SOCKS5' },
                  { value: 'http', label: 'HTTP CONNECT' },
                ]}
                onValueChange={(value) =>
                  setConfig(
                    value === 'vless'
                      ? { ...newOutbound(), name: config.name }
                      : {
                          id: config.id,
                          name: config.name,
                          type: value as 'socks' | 'http',
                          server: '',
                          server_port: 1080,
                          username: '',
                          password: '',
                          tls: false,
                        },
                  )
                }
              />
              {text('server', '服务器地址')}
              <Input
                label="服务器端口"
                type="number"
                min={1}
                max={65535}
                value={config.server_port || ''}
                onChange={(e) => change({ server_port: Number(e.target.value) })}
              />
              {config.type === 'vless' ? (
                <>
                  <PasswordField
                    label="UUID"
                    value={config.uuid ?? ''}
                    onChange={(e) => change({ uuid: e.target.value })}
                    autoComplete="off"
                    description={outbound?.has_uuid ? '已设置，留空保留原值。' : undefined}
                    messages={{ showPassword: '显示 UUID', hidePassword: '隐藏 UUID' }}
                  />
                  <Select
                    label="连接安全"
                    value={config.tls ? 'reality' : 'none'}
                    options={[
                      { value: 'reality', label: 'REALITY' },
                      { value: 'none', label: '无 TLS' },
                    ]}
                    onValueChange={(v) =>
                      change({
                        tls: v === 'reality',
                        server_name: '',
                        public_key: '',
                        short_id: '',
                        flow: v === 'reality' ? 'xtls-rprx-vision' : '',
                        fingerprint: v === 'reality' ? 'chrome' : '',
                      })
                    }
                  />
                  {config.tls && (
                    <>
                      {text('server_name', 'SNI')}
                      {text('public_key', 'REALITY 公钥', 43)}
                      {text('short_id', 'Short ID（可留空）', 16)}
                      <Select
                        label="Flow"
                        value={config.flow || 'none'}
                        options={[
                          { value: 'xtls-rprx-vision', label: 'Vision' },
                          { value: 'none', label: '不启用 Flow' },
                        ]}
                        onValueChange={(v) => change({ flow: v === 'none' ? '' : v })}
                      />
                      <ClientFingerprintSelect
                        value={config.fingerprint ?? 'chrome'}
                        onValueChange={(fingerprint) => change({ fingerprint })}
                      />
                    </>
                  )}
                </>
              ) : (
                <>
                  {text('username', '用户名（无认证时留空）', 256)}
                  <PasswordField
                    label="密码"
                    autoComplete="new-password"
                    value={config.password ?? ''}
                    onChange={(e) => change({ password: e.target.value })}
                    description={outbound?.has_password ? '已设置，留空保留原值。' : undefined}
                    messages={{ showPassword: '显示密码', hidePassword: '隐藏密码' }}
                  />
                  {config.type === 'http' && (
                    <>
                      <Select
                        label="连接安全"
                        value={config.tls ? 'tls' : 'plain'}
                        options={[
                          { value: 'tls', label: 'TLS，验证证书' },
                          { value: 'plain', label: '明文 HTTP' },
                        ]}
                        onValueChange={(v) => change({ tls: v === 'tls', server_name: '' })}
                      />
                      {config.tls && text('server_name', 'TLS 服务器名称（可留空）')}
                      <p className="text-text-secondary">
                        HTTP CONNECT 仅支持 TCP 分流规则，不能作为默认出口。
                      </p>
                    </>
                  )}
                </>
              )}
            </fieldset>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                取消编辑
              </Button>
              <Button disabled={busy}>
                {busy ? '正在处理…' : outbound ? '预览修改' : '保存出口'}
              </Button>
            </div>
          </form>
        </div>
        <Dialog
          open={preview !== null}
          onOpenChange={(open) => {
            if (!open && !busy) setPreview(null);
          }}
        >
          <DialogContent
            title="确认修改共享出口"
            description="保存后同步已发布的引用配置，可能重启相关节点的 sing-box。未发布草稿不会自动应用。"
            footer={
              <>
                <Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>
                  返回编辑
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => action(() => save(preview?.confirmation ?? ''))}
                >
                  保存并同步出口
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              <p>
                {config.name}：{config.server}:{config.server_port}
              </p>
              <p className="tabular-nums">影响 {preview?.impacts.length ?? 0} 个节点</p>
              <ul className="space-y-2">
                {preview?.impacts.map((i) => (
                  <li key={i.engine_id} className="break-all">
                    {i.node_name}：
                    {i.draft_only ? '仅草稿引用' : i.state === 'online' ? '等待同步' : '上线后同步'}
                  </li>
                ))}
              </ul>
            </div>
          </DialogContent>
        </Dialog>
      </DrawerContent>
    </Drawer>
  );
}
