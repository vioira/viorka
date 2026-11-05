import { useRef, useState } from 'react';
import type { EngineService } from '@/api/engines';
import type { RouteRule } from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
export default function RuleEditor({
  rule,
  services,
  options,
  onClose,
  onSave,
}: {
  rule: RouteRule;
  services: EngineService[];
  options: { value: string; label: string }[];
  onClose: () => void;
  onSave: (rule: RouteRule) => void;
}) {
  const [value, setValue] = useState(rule);
  const [service, setService] = useState('');
  const { toast } = useToastStack();
  const focus = useRef<HTMLElement | null>(null);
  const [fields, setFields] = useState({
    domain: rule.domain?.join(', ') ?? '',
    domain_suffix: rule.domain_suffix?.join(', ') ?? '',
    ip_cidr: rule.ip_cidr?.join(', ') ?? '',
    port: rule.port?.join(', ') ?? '',
    port_range: rule.port_range?.join(', ') ?? '',
  });
  function submit() {
    try {
      const split = (s: string) =>
        s
          .split(/[,，\s]+/)
          .map((v) => v.trim())
          .filter(Boolean);
      const next = {
        ...value,
        domain: split(fields.domain),
        domain_suffix: split(fields.domain_suffix),
        ip_cidr: split(fields.ip_cidr),
        port: split(fields.port).map(Number),
        port_range: split(fields.port_range),
      };
      if (!next.name.trim()) throw new Error('请输入规则名称。');
      if (next.port.some((p) => !Number.isInteger(p) || p < 1 || p > 65535))
        throw new Error('端口须为 1 至 65535 的整数。');
      if (next.match_all) {
        next.domain = [];
        next.domain_suffix = [];
        next.ip_cidr = [];
        next.port = [];
        next.port_range = [];
        next.network = [];
      } else if (
        ![
          ...next.domain,
          ...next.domain_suffix,
          ...next.ip_cidr,
          ...next.port,
          ...next.port_range,
          ...(next.network ?? []),
        ].length
      )
        throw new Error('请添加匹配条件，或明确选择全部流量。');
      onSave(next);
    } catch (e) {
      toast({
        id: 'route-form',
        type: 'error',
        title: '未能加入分流草稿',
        description: e instanceof Error ? e.message : '请检查规则参数。',
      });
    }
  }
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        title="编辑分流规则"
        description="规则先加入节点草稿，保存并应用后生效。"
        onOpenAutoFocus={() => {
          focus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focus.current?.focus();
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            label="规则名称"
            maxLength={128}
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
          <Select
            label="适用服务"
            placeholder="不选择表示全部服务"
            value={service}
            options={services
              .filter((s) => !value.inbound?.includes(s.id))
              .map((s) => ({ value: s.id, label: s.name }))}
            onValueChange={(id) => {
              setValue({ ...value, inbound: [...(value.inbound ?? []), id] });
              setService('');
            }}
          />
          <div className="flex flex-wrap gap-2">
            {value.inbound?.map((id) => (
              <Button
                key={id}
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() =>
                  setValue({ ...value, inbound: value.inbound?.filter((v) => v !== id) })
                }
              >
                移除 {services.find((s) => s.id === id)?.name ?? id}
              </Button>
            ))}
          </div>
          <Select
            label="匹配方式"
            value={value.match_all ? 'all' : 'conditions'}
            options={[
              { value: 'conditions', label: '按条件匹配' },
              { value: 'all', label: '全部流量' },
            ]}
            onValueChange={(v) => setValue({ ...value, match_all: v === 'all' })}
          />
          {!value.match_all && (
            <>
              {(
                [
                  ['domain', '完整域名'],
                  ['domain_suffix', '域名后缀'],
                  ['ip_cidr', '目标 IP 网段（CIDR）'],
                  ['port', '目标端口'],
                  ['port_range', '端口范围（例如 1000:2000）'],
                ] as const
              ).map(([key, label]) => (
                <Input
                  key={key}
                  label={label}
                  description="多个值以逗号分隔，留空不限制。"
                  maxLength={4096}
                  value={fields[key]}
                  onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                />
              ))}
              <Select
                label="网络类型"
                value={value.network?.length === 1 ? value.network[0] : 'all'}
                options={[
                  { value: 'all', label: 'TCP 和 UDP' },
                  { value: 'tcp', label: 'TCP' },
                  { value: 'udp', label: 'UDP' },
                ]}
                onValueChange={(n) => setValue({ ...value, network: n === 'all' ? [] : [n] })}
              />
            </>
          )}
          <Select
            label="执行动作"
            value={value.outbound}
            options={options}
            onValueChange={(outbound) => setValue({ ...value, outbound })}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              取消编辑
            </Button>
            <Button>加入分流草稿</Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
