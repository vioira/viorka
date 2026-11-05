import { useId, useRef, useState } from 'react';
import type { EngineService } from '@/api/engines';
import type { ProtocolPreset } from '@/api/protocol-presets';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import PresetPicker, { presetIssue } from './PresetPicker';

export function referenceService(service: EngineService, preset: ProtocolPreset): EngineService {
  const split = preset.config.target.lastIndexOf(':');
  return {
    ...service,
    preset_id: preset.id,
    port_override: undefined,
    sni_override: undefined,
    name: preset.config.name,
    listen_port: preset.config.port,
    server_name: preset.config.server_name,
    target_host: preset.config.target.slice(0, split).replace(/^\[|\]$/g, ''),
    target_port: Number(preset.config.target.slice(split + 1)),
  };
}

export default function PresetServiceEditor({
  service,
  engine,
  editing,
  onClose,
  onSave,
}: {
  service: EngineService;
  engine: string;
  editing: boolean;
  onClose: () => void;
  onSave: (service: EngineService) => void;
}) {
  const formId = useId();
  const [value, setValue] = useState(service);
  const [preset, setPreset] = useState<ProtocolPreset | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [portOverride, setPortOverride] = useState<string | null>(null);
  const [sniOverride, setSniOverride] = useState<string | null>(null);
  const port =
    portOverride ?? (value.port_override === undefined ? '' : String(value.port_override));
  const sni = sniOverride ?? value.sni_override ?? '';
  const focus = useRef<HTMLElement | null>(null);
  const { toast } = useToastStack();
  const ready = preset !== null && !presetIssue(preset, engine);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={editing ? '编辑服务' : '添加服务'}
        description={`引用协议配置到 ${engine}。加入本地草稿后，保存并应用才会在节点生效。`}
        className="[--dialog-width:560px]"
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" className="min-h-11" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" form={formId} className="min-h-11" disabled={!ready}>
              加入草稿
            </Button>
          </div>
        }
        onOpenAutoFocus={() => {
          focus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focus.current?.focus();
        }}
      >
        <form
          id={formId}
          className="space-y-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || !preset) return;
            const listenPort = port ? Number(port) : preset.config.port;
            const serverName = sni.trim() || preset.config.server_name;
            if (
              !value.name.trim() ||
              !value.listen_host.trim() ||
              listenPort < 1 ||
              listenPort > 65535 ||
              !serverName ||
              Boolean(value.public_host.trim()) !== value.public_port > 0 ||
              value.public_port > 65535
            ) {
              toast({
                id: 'engine-service-validation',
                type: 'error',
                title: '请检查节点参数',
                description:
                  '端口须为 1–65535，监听地址和 SNI 不能为空；公网地址与端口须同时填写。',
              });
              return;
            }
            onSave({
              ...value,
              name: value.name.trim(),
              listen_host: value.listen_host.trim(),
              server_name: serverName,
              port_override: port ? listenPort : undefined,
              sni_override: sni.trim() || undefined,
              listen_port: listenPort,
              public_host: value.public_host.trim(),
            });
          }}
        >
          <PresetPicker
            engine={engine}
            value={value.preset_id ?? ''}
            onResolve={setPreset}
            onSelect={(next) => {
              setPreset(next);
              setValue(referenceService(value, next));
              setPortOverride('');
              setSniOverride('');
            }}
          />
          <Input
            label="端口（可选）"
            className="min-h-11 tabular-nums"
            inputMode="numeric"
            maxLength={5}
            disabled={!ready}
            value={port}
            placeholder={preset ? `${preset.config.port}，与协议配置一致` : '沿用协议配置端口'}
            onChange={(event) => {
              if (/^\d*$/.test(event.target.value)) setPortOverride(event.target.value);
            }}
          />
          <Input
            label="域名（SNI，可选）"
            className="min-h-11"
            maxLength={253}
            disabled={!ready}
            value={sni}
            placeholder={preset ? `沿用协议配置：${preset.config.server_name}` : '沿用协议配置 SNI'}
            description="留空沿用协议配置。覆盖时须与 REALITY 握手目标的证书域名匹配。"
            onChange={(event) => {
              setSniOverride(event.target.value);
            }}
          />
          <div className="space-y-4">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              aria-expanded={advanced}
              aria-controls="service-node-options"
              onClick={() => setAdvanced(!advanced)}
            >
              {advanced ? '收起节点参数' : '设置节点参数（可选）'}
            </Button>
            {advanced && (
              <div id="service-node-options" className="space-y-4">
                <Input
                  label="服务名称"
                  value={value.name}
                  maxLength={128}
                  className="min-h-11"
                  disabled={!ready}
                  onChange={(event) => setValue({ ...value, name: event.target.value })}
                />
                <Input
                  label="监听 IP"
                  value={value.listen_host}
                  maxLength={45}
                  className="min-h-11"
                  description="默认 0.0.0.0，监听本机全部 IPv4 地址。"
                  onChange={(event) => setValue({ ...value, listen_host: event.target.value })}
                />
                <Input
                  label="对外入口 IP 或域名"
                  value={value.public_host}
                  maxLength={253}
                  className="min-h-11"
                  onChange={(event) => setValue({ ...value, public_host: event.target.value })}
                />
                <Input
                  label="对外入口端口"
                  value={value.public_port || ''}
                  inputMode="numeric"
                  maxLength={5}
                  className="min-h-11 tabular-nums"
                  description="公网地址和端口须同时填写，且来自已确认的地址或 NAT 映射；留空不生成客户端连接。"
                  onChange={(event) => {
                    if (/^\d*$/.test(event.target.value))
                      setValue({ ...value, public_port: Number(event.target.value) });
                  }}
                />
              </div>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
