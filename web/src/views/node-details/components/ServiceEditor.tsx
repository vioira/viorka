import { useEffect, useRef, useState } from 'react';
import type { EngineService } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export default function ServiceEditor({
  service,
  engine,
  onClose,
  onSave,
}: {
  service: EngineService | null;
  engine: string;
  onClose: () => void;
  onSave: (service: EngineService) => void;
}) {
  const [value, setValue] = useState<EngineService | null>(service);
  const { toast } = useToastStack();
  const focus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (service) setValue(service);
  }, [service]);
  const fields: {
    key: keyof EngineService;
    label: string;
    numeric?: boolean;
    optional?: boolean;
  }[] = [
    { key: 'name', label: '服务名称' },
    { key: 'listen_host', label: '本地监听 IP' },
    { key: 'listen_port', label: '本地监听端口', numeric: true },
    { key: 'target_host', label: engine === 'realm' ? '转发目标 IP 或域名' : 'REALITY 握手目标' },
    { key: 'target_port', label: '目标端口', numeric: true },
    ...(engine === 'realm'
      ? []
      : [{ key: 'server_name' as const, label: '允许的服务器名称（SNI）' }]),
    { key: 'public_host', label: '对外入口 IP 或域名（可选）', optional: true },
    { key: 'public_port', label: '对外入口端口（可选）', numeric: true, optional: true },
  ];
  return (
    <Drawer
      open={service !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        title={engine === 'realm' ? '编辑 TCP 转发规则' : '编辑 VLESS + TCP + REALITY 服务'}
        description="先加入本地草稿，再保存共享草稿并应用。对外入口须来自已确认的公网地址或已有 TCP 映射。"
        onOpenAutoFocus={() => {
          focus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focus.current?.focus();
        }}
      >
        {value && (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !value.name.trim() ||
                !value.listen_host ||
                !value.target_host ||
                value.listen_port < 1 ||
                value.listen_port > 65535 ||
                value.target_port < 1 ||
                value.target_port > 65535 ||
                (engine !== 'realm' && !value.server_name)
              ) {
                toast({
                  id: 'engine-service-validation',
                  type: 'error',
                  title: '请补全服务配置',
                  description: '名称、监听地址、目标和端口必填；REALITY 还需要服务器名称。',
                });
                return;
              }
              onSave(value);
            }}
          >
            {fields.map((field) => (
              <Input
                key={field.key}
                label={field.label}
                className="min-h-11"
                value={
                  field.numeric
                    ? value[field.key] === 0
                      ? ''
                      : String(value[field.key])
                    : String(value[field.key])
                }
                inputMode={field.numeric ? 'numeric' : undefined}
                maxLength={field.numeric ? 5 : 253}
                onChange={(event) => {
                  const next = event.target.value;
                  if (field.numeric && !/^\d*$/.test(next)) return;
                  setValue({ ...value, [field.key]: field.numeric ? Number(next) : next });
                }}
              />
            ))}
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              aria-pressed={value.enabled}
              onClick={() => setValue({ ...value, enabled: !value.enabled })}
            >
              {value.enabled ? '草稿状态：启用' : '草稿状态：停用'}
            </Button>
            <p className="text-text-secondary">
              停用后保留端口分配。没有对外入口时可以部署，但不会提供客户端连接信息。
            </p>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" className="min-h-11" onClick={onClose}>
                取消编辑
              </Button>
              <Button type="submit" className="min-h-11">
                加入草稿
              </Button>
            </div>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}
