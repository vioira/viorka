import { X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { EngineService } from '@/api/engines';
import type { RouteRule } from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export interface RouteOutletOption {
  value: string;
  label: string;
  http?: boolean;
  disabled?: boolean;
}

const split = (text: string) => text.split(/[,，\s]+/).filter(Boolean);

export default function RuleEditor({
  rule,
  editing,
  services,
  options,
  disabled,
  returnFocus,
  onClose,
  onSave,
}: {
  rule: RouteRule;
  editing: boolean;
  services: EngineService[];
  options: RouteOutletOption[];
  disabled: boolean;
  returnFocus: () => void;
  onClose: () => void;
  onSave: (rule: RouteRule) => void;
}) {
  const formId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(rule);
  const { toast } = useToastStack();
  const [fields, setFields] = useState({
    domain: rule.domain?.join(', ') ?? '',
    domain_suffix: rule.domain_suffix?.join(', ') ?? '',
    ip_cidr: rule.ip_cidr?.join(', ') ?? '',
    port: rule.port?.join(', ') ?? '',
    port_range: rule.port_range?.join(', ') ?? '',
  });
  const availableServices = services.filter((service) => !value.inbound?.includes(service.id));
  const outlet = options.find((option) => option.value === value.outbound);
  const network = value.network?.length === 1 ? value.network[0] : 'all';

  function submit() {
    if (disabled) return;
    const next = {
      ...value,
      name: value.name.trim(),
      domain: value.match_all ? [] : split(fields.domain),
      domain_suffix: value.match_all ? [] : split(fields.domain_suffix),
      ip_cidr: value.match_all ? [] : split(fields.ip_cidr),
      port: value.match_all ? [] : split(fields.port).map(Number),
      port_range: value.match_all ? [] : split(fields.port_range),
      network: value.match_all ? [] : (value.network ?? []),
    };
    const conditions = [
      next.domain,
      next.domain_suffix,
      next.ip_cidr,
      next.port,
      next.port_range,
      next.network,
    ];
    let error = '';
    if (!next.name) error = '请输入规则名称。';
    else if (new TextEncoder().encode(next.name).length > 128) error = '规则名称最多 128 字节。';
    else if (!outlet || outlet.disabled) error = '请选择可用的出口。';
    else if (next.port.some((port) => !Number.isInteger(port) || port < 1 || port > 65535))
      error = '端口须为 1 至 65535 的整数。';
    else if (next.enabled && outlet.http && (next.match_all || network !== 'tcp'))
      error = 'HTTP CONNECT 仅支持 TCP。请选择 TCP 或更换出口。';
    else if (!next.match_all && !conditions.some((items) => items.length))
      error = '请填写匹配条件，或选择全部流量。';
    if (error) {
      toast({ id: 'route-form', type: 'error', title: '请检查分流规则', description: error });
      return;
    }
    onSave(next);
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        title={editing ? '编辑分流规则' : '添加分流规则'}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInput.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button variant="secondary" type="submit" form={formId} disabled={disabled}>
              {editing ? '更新草稿' : '加入草稿'}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="min-w-0 space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-4">
            <Input
              ref={nameInput}
              label="规则名称"
              maxLength={128}
              value={value.name}
              onChange={(event) => setValue({ ...value, name: event.target.value })}
            />
            <Select
              label="出口"
              className="w-full"
              value={value.outbound}
              options={options}
              description={outlet?.http ? 'HTTP CONNECT 仅支持 TCP 规则。' : undefined}
              onValueChange={(outbound) => setValue({ ...value, outbound })}
            />
            <div className="space-y-2">
              <Select
                label="适用服务"
                className="w-full"
                placeholder={value.inbound?.length ? '添加服务' : '全部服务'}
                value=""
                disabled={availableServices.length === 0}
                options={availableServices.map((service) => ({
                  value: service.id,
                  label: service.name,
                }))}
                onValueChange={(id) =>
                  setValue({ ...value, inbound: [...(value.inbound ?? []), id] })
                }
              />
              {!!value.inbound?.length && (
                <div className="flex flex-wrap gap-2">
                  {value.inbound.map((id) => {
                    const name = services.find((service) => service.id === id)?.name ?? id;
                    return (
                      <Button
                        key={id}
                        type="button"
                        variant="secondary"
                        aria-label={`移除服务 ${name}`}
                        onClick={() =>
                          setValue({
                            ...value,
                            inbound: value.inbound?.filter((item) => item !== id),
                          })
                        }
                      >
                        <span className="max-w-44 truncate" title={name}>
                          {name}
                        </span>
                        <X size={16} strokeWidth={1.75} aria-hidden="true" />
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-4 border-t-[1px] border-border pt-4">
            <Select
              label="匹配方式"
              className="w-full"
              value={value.match_all ? 'all' : 'conditions'}
              options={[
                { value: 'conditions', label: '按条件匹配' },
                { value: 'all', label: '全部流量' },
              ]}
              onValueChange={(mode) => setValue({ ...value, match_all: mode === 'all' })}
            />
            {!value.match_all && (
              <>
                <p className="text-(length:--text-xs) text-text-secondary">
                  同一字段任一值匹配即可，多个值用逗号分隔。不同字段须同时匹配。
                </p>
                <div className="grid min-w-0 gap-4 min-[480px]:grid-cols-2">
                  {(
                    [
                      ['domain', '完整域名', ''],
                      ['domain_suffix', '域名后缀', ''],
                      ['ip_cidr', '目标网段（CIDR）', ''],
                      ['port', '目标端口', ''],
                      ['port_range', '端口范围', '如 1000:2000'],
                    ] as const
                  ).map(([key, label, placeholder]) => (
                    <Input
                      key={key}
                      label={label}
                      placeholder={placeholder}
                      maxLength={4096}
                      value={fields[key]}
                      onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
                    />
                  ))}
                  <Select
                    label="传输协议"
                    className="w-full"
                    value={network}
                    options={[
                      { value: 'all', label: 'TCP 和 UDP' },
                      { value: 'tcp', label: 'TCP' },
                      { value: 'udp', label: 'UDP' },
                    ]}
                    onValueChange={(next) =>
                      setValue({ ...value, network: next === 'all' ? [] : [next] })
                    }
                  />
                </div>
              </>
            )}
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
