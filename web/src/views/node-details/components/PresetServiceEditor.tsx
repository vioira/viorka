import { useId, useState } from 'react';
import type { EngineService } from '@/api/engines';
import type { ProtocolPreset } from '@/api/protocol-presets';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import PresetPicker, { presetIssue } from './PresetPicker';

export function referenceService(
  service: EngineService,
  preset: ProtocolPreset,
  nodeName: string,
): EngineService {
  const split = preset.config.target.lastIndexOf(':');
  return {
    ...service,
    preset_id: preset.id,
    port_override: undefined,
    sni_override: undefined,
    name: `${nodeName}-${preset.config.name}`,
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
  nodeName,
  returnFocus,
  onClose,
  onSave,
}: {
  service: EngineService;
  engine: string;
  editing: boolean;
  nodeName: string;
  returnFocus: () => void;
  onClose: () => void;
  onSave: (service: EngineService) => void;
}) {
  const formId = useId();
  const [value, setValue] = useState(service);
  const [followPresetName, setFollowPresetName] = useState(!editing);
  const [followServicePort, setFollowServicePort] = useState(
    !editing && Boolean(service.public_host),
  );
  const [preset, setPreset] = useState<ProtocolPreset | null>(null);
  const [portOverride, setPortOverride] = useState<string | null>(null);
  const port =
    portOverride ?? (value.port_override === undefined ? '' : String(value.port_override));
  const listenPort = port ? Number(port) : (preset?.config.port ?? value.listen_port);
  const publicPort = followServicePort ? listenPort : value.public_port;
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
        aria-describedby={undefined}
        className="[--dialog-width:560px]"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="secondary" form={formId} disabled={!ready}>
              {editing ? '更新草稿' : '加入草稿'}
            </Button>
          </>
        }
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <form
          id={formId}
          className="space-y-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || !preset) return;
            const serverName = preset.config.server_name;
            if (
              !value.name.trim() ||
              !value.listen_host.trim() ||
              listenPort < 1 ||
              listenPort > 65535 ||
              !serverName ||
              Boolean(value.public_host.trim()) !== publicPort > 0 ||
              publicPort > 65535
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
              sni_override: undefined,
              listen_port: listenPort,
              public_host: value.public_host.trim(),
              public_port: publicPort,
            });
          }}
        >
          <PresetPicker
            engine={engine}
            value={value.preset_id ?? ''}
            onResolve={setPreset}
            onSelect={(next) => {
              setPreset(next);
              const referenced = referenceService(value, next, nodeName);
              setValue({ ...referenced, name: followPresetName ? referenced.name : value.name });
              setPortOverride('');
            }}
          />
          <Input
            label="服务名称"
            value={value.name}
            maxLength={128}
            disabled={!ready}
            onChange={(event) => {
              setFollowPresetName(false);
              setValue({ ...value, name: event.target.value });
            }}
          />
          <div className="grid min-w-0 gap-4 min-[480px]:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
            <Input
              label="监听 IP"
              value={value.listen_host}
              maxLength={45}
              onChange={(event) => setValue({ ...value, listen_host: event.target.value })}
            />
            <Input
              label="监听端口（可选覆盖）"
              className="tabular-nums"
              inputMode="numeric"
              maxLength={5}
              disabled={!ready}
              value={port}
              placeholder={preset ? String(preset.config.port) : '沿用协议配置'}
              onChange={(event) => {
                if (/^\d*$/.test(event.target.value)) setPortOverride(event.target.value);
              }}
            />
            {preset && (
              <p className="flex flex-wrap gap-x-2 text-(length:--text-xs) text-text-secondary wrap-anywhere min-[480px]:col-span-2">
                <span>SNI</span>
                <span>{preset.config.server_name}</span>
              </p>
            )}
          </div>
          <fieldset className="min-w-0 space-y-3">
            <legend className="font-medium text-foreground">公网入口（可选）</legend>
            <p className="text-(length:--text-xs) text-text-secondary">
              NAT 节点使用实际的公网映射。留空时不生成连接信息。
            </p>
            <div className="grid min-w-0 gap-4 min-[480px]:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
              <Input
                label="公网 IP 或域名"
                value={value.public_host}
                maxLength={253}
                onChange={(event) => setValue({ ...value, public_host: event.target.value })}
              />
              <Input
                label="公网端口"
                value={publicPort || ''}
                inputMode="numeric"
                maxLength={5}
                className="tabular-nums"
                onChange={(event) => {
                  if (/^\d*$/.test(event.target.value)) {
                    setFollowServicePort(false);
                    setValue({ ...value, public_port: Number(event.target.value) });
                  }
                }}
              />
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
