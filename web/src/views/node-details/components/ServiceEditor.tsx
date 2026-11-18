import { useId, useState } from 'react';
import type { EngineService } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export default function ServiceEditor({
  service,
  engine,
  editing,
  returnFocus,
  onClose,
  onSave,
}: {
  service: EngineService;
  engine: string;
  editing: boolean;
  returnFocus: () => void;
  onClose: () => void;
  onSave: (service: EngineService) => void;
}) {
  const formId = useId();
  const [value, setValue] = useState(service);
  const [followServicePort, setFollowServicePort] = useState(
    !editing && Boolean(service.public_host),
  );
  const { toast } = useToastStack();
  const realm = engine === 'realm';
  const fields: {
    key: keyof EngineService;
    label: string;
    numeric?: boolean;
    wide?: boolean;
  }[] = [
    { key: 'name', label: realm ? '规则名称' : '服务名称', wide: true },
    { key: 'listen_host', label: '监听 IP' },
    { key: 'listen_port', label: '监听端口', numeric: true },
    { key: 'target_host', label: realm ? '转发目标 IP 或域名' : 'REALITY 握手目标' },
    { key: 'target_port', label: '目标端口', numeric: true },
    ...(realm ? [] : [{ key: 'server_name' as const, label: '服务器名称（SNI）', wide: true }]),
    { key: 'public_host', label: '公网 IP 或域名（可选）' },
    { key: 'public_port', label: '公网端口（可选）', numeric: true },
  ];
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        title={realm ? (editing ? '编辑 TCP 转发规则' : '添加 TCP 转发规则') : '编辑代理服务'}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="secondary" form={formId}>
              {editing ? '更新草稿' : '加入草稿'}
            </Button>
          </>
        }
      >
        <form
          id={formId}
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
              Boolean(value.public_host.trim()) !== value.public_port > 0 ||
              value.public_port > 65535 ||
              (!realm && !value.server_name)
            ) {
              toast({
                id: 'engine-service-validation',
                type: 'error',
                title: '请补全服务配置',
                description:
                  '名称、监听地址、目标和端口必填；REALITY 需要服务器名称。公网地址和 1–65535 端口须同时填写。',
              });
              return;
            }
            onSave(value);
          }}
        >
          <div className="grid min-w-0 gap-4 min-[480px]:grid-cols-2">
            {fields.map((field) => (
              <div
                key={field.key}
                className={field.wide ? 'min-w-0 min-[480px]:col-span-2' : 'min-w-0'}
              >
                <Input
                  label={field.label}
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
                    if (field.key === 'public_port') setFollowServicePort(false);
                    setValue({
                      ...value,
                      ...(field.key === 'listen_port' && followServicePort
                        ? { public_port: Number(next) }
                        : {}),
                      [field.key]: field.numeric ? Number(next) : next,
                    });
                  }}
                />
              </div>
            ))}
          </div>
          <p className="text-(length:--text-xs) text-text-secondary">
            NAT 节点使用实际的公网映射。
          </p>
          <Checkbox
            label={realm ? '启用转发规则' : '启用服务'}
            checked={value.enabled}
            onCheckedChange={(enabled) => setValue({ ...value, enabled: enabled === true })}
          />
        </form>
      </DrawerContent>
    </Drawer>
  );
}
