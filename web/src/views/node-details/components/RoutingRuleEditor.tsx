import { Plus, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { EngineService } from '@/api/engines';
import type { RouteRule } from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { TagInput } from '@/components/arc/tag-input/tag-input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import RoutingChoices from './RoutingChoices';
import RoutingGeoPicker, { catalogHas, useRoutingGeoCatalog } from './RoutingGeoPicker';
import {
  routeConditionError,
  routeConditionGroups,
  routeConditionValues,
  routeMatchSummary,
} from './routing-rule-conditions';

export interface RouteOutletOption {
  value: string;
  label: string;
  http?: boolean;
  disabled?: boolean;
}

const matchOptions = [
  { value: 'conditions', label: '按条件匹配' },
  { value: 'all', label: '匹配全部流量' },
];
const networkOptions = [
  { value: 'all', label: '全部' },
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
];
const split = (value: string) => value.split(/[,，\s]+/).filter(Boolean);

const otherFields = [
  ...routeConditionGroups
    .flatMap(
      (group) =>
        [...group.fields] as Array<(typeof routeConditionGroups)[number]['fields'][number]>,
    )
    .filter((field) => 'placeholder' in field),
  { key: 'network', label: '传输协议', placeholder: '' } as const,
];

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
  const [ports, setPorts] = useState(() => routeConditionValues(rule, 'port'));
  const geoKinds = ['geosite', 'geoip'] as const;
  const geo = useRoutingGeoCatalog(geoKinds.some((kind) => !!rule[kind]?.length));
  const geoUnverified =
    !value.match_all &&
    geoKinds.some((kind) =>
      value[kind]?.some(
        (code) => geo.status !== 'ready' || !geo.catalog || !catalogHas(geo.catalog[kind], code),
      ),
    );
  const [activeFields, setActiveFields] = useState(() =>
    otherFields.filter((field) => rule[field.key]?.length).map((field) => field.key),
  );
  const { toast } = useToastStack();
  const availableServices = services.filter((service) => !value.inbound?.includes(service.id));
  const serviceName = (id: string) => services.find((service) => service.id === id)?.name ?? id;
  const outlet = options.find((option) => option.value === value.outbound);
  const network = value.network?.length === 1 ? value.network[0] : 'all';
  const summary = routeMatchSummary(
    value,
    value.inbound?.map(serviceName) ?? [],
    outlet?.label ?? '出口不可用',
    ports,
  );

  function submit() {
    if (disabled || geoUnverified) return;
    const name = value.name.trim();
    let error = '';
    if (!name) error = '请输入规则名称。';
    else if (new TextEncoder().encode(name).length > 128) error = '规则名称最多 128 字节。';
    else if (!outlet || outlet.disabled) error = '请选择可用的出口。';
    else if (value.enabled && outlet.http && (value.match_all || network !== 'tcp'))
      error = 'HTTP CONNECT 仅支持 TCP。请选择 TCP 或更换出口。';
    const next = {
      ...value,
      name,
      port: [...new Set(ports.map((port) => (/^\d+$/.test(port) ? Number(port) : NaN)))],
    };
    if (!error && !value.match_all) error = routeConditionError(next);
    if (error) {
      toast({ id: 'route-form', type: 'error', title: '请检查分流规则', description: error });
      return;
    }
    onSave(
      value.match_all
        ? {
            id: next.id,
            name,
            enabled: next.enabled,
            outbound: next.outbound,
            inbound: next.inbound,
            match_all: true,
          }
        : next,
    );
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        style={{ width: 'min(100vw, 36rem)' }}
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
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="secondary"
              type="submit"
              form={formId}
              disabled={disabled || geoUnverified}
            >
              {editing ? '更新草稿' : '加入草稿'}
            </Button>
          </div>
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
          <fieldset disabled={disabled} className="min-w-0 space-y-4">
            <legend className="sr-only">规则设置</legend>
            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                ref={nameInput}
                label="规则名称"
                maxLength={128}
                value={value.name}
                onChange={(event) => setValue({ ...value, name: event.target.value })}
              />
              <div className="flex min-h-(--control-height-md) items-center">
                <Checkbox
                  label="启用规则"
                  checked={value.enabled}
                  onCheckedChange={(checked) => setValue({ ...value, enabled: checked === true })}
                />
              </div>
            </div>
            <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Select
                  label="适用服务"
                  className="w-full"
                  placeholder={value.inbound?.length ? '添加服务' : '全部服务'}
                  value=""
                  disabled={
                    disabled || availableServices.length === 0 || (value.inbound?.length ?? 0) >= 32
                  }
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
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setValue({ ...value, inbound: [] })}
                    >
                      改为全部服务
                    </Button>
                    {value.inbound.map((id) => (
                      <Button
                        key={id}
                        type="button"
                        variant="secondary"
                        aria-label={`移除服务 ${serviceName(id)}`}
                        onClick={() =>
                          setValue({
                            ...value,
                            inbound: value.inbound?.filter((item) => item !== id),
                          })
                        }
                      >
                        <span className="max-w-36 truncate" title={serviceName(id)}>
                          {serviceName(id)}
                        </span>
                        <X size={16} strokeWidth={1.75} aria-hidden="true" />
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <Select
                label="目标出口"
                className="w-full"
                value={value.outbound}
                options={options}
                description={outlet?.http ? 'HTTP CONNECT 仅支持 TCP 规则。' : undefined}
                disabled={disabled}
                onValueChange={(outbound) => setValue({ ...value, outbound })}
              />
            </div>
          </fieldset>
          <fieldset disabled={disabled} className="min-w-0 space-y-2">
            <legend className="mb-2 text-(length:--text-sm) font-medium">匹配方式</legend>
            <RoutingChoices
              label="匹配方式"
              options={matchOptions}
              value={value.match_all ? 'all' : 'conditions'}
              onValueChange={(mode) => setValue({ ...value, match_all: mode === 'all' })}
            />
          </fieldset>
          {!value.match_all && (
            <fieldset disabled={disabled} className="min-w-0 space-y-3">
              <legend className="text-(length:--text-sm) font-medium">匹配条件</legend>
              <div>
                {geoKinds.map((kind) => (
                  <RoutingGeoPicker
                    key={kind}
                    kind={kind}
                    disabled={disabled}
                    values={value[kind] ?? []}
                    state={geo}
                    onChange={(codes) => setValue((current) => ({ ...current, [kind]: codes }))}
                  />
                ))}
              </div>
              {otherFields
                .filter((field) => activeFields.includes(field.key))
                .map((field) => (
                  <div
                    key={field.key}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
                  >
                    {field.key === 'network' ? (
                      <div className="space-y-2">
                        <p className="text-text-secondary">传输协议</p>
                        <RoutingChoices
                          label="传输协议"
                          options={networkOptions}
                          value={network}
                          onValueChange={(protocol) =>
                            setValue({ ...value, network: protocol === 'all' ? [] : [protocol] })
                          }
                        />
                      </div>
                    ) : (
                      <TagInput
                        label={field.label}
                        placeholder={field.placeholder}
                        value={
                          field.key === 'port' ? ports : routeConditionValues(value, field.key)
                        }
                        onValueChange={(items) => {
                          const next = [...new Set(items.flatMap(split))];
                          if (field.key === 'port') setPorts(next);
                          else setValue((current) => ({ ...current, [field.key]: next }));
                        }}
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`移除${field.label}条件`}
                      onClick={() => {
                        setActiveFields((items) => items.filter((key) => key !== field.key));
                        if (field.key === 'port') setPorts([]);
                        setValue((current) => ({ ...current, [field.key]: [] }));
                      }}
                    >
                      <X size={16} aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              {activeFields.length < otherFields.length && (
                <DropdownMenu
                  label="添加其他条件"
                  icon={<Plus size={16} aria-hidden="true" />}
                  items={otherFields
                    .filter((field) => !activeFields.includes(field.key))
                    .map((field) => ({
                      label: field.label,
                      disabled,
                      onSelect: () => setActiveFields((items) => [...items, field.key]),
                    }))}
                />
              )}
            </fieldset>
          )}
          <section className="space-y-2 border-t-[1px] border-border pt-4" aria-label="匹配预览">
            <h3 className="text-(length:--text-sm) font-medium">匹配预览</h3>
            <p role="status" className="wrap-anywhere text-(length:--text-sm) text-text-secondary">
              {summary}
            </p>
          </section>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
