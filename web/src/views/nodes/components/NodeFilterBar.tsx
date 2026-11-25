import { Check, ChevronDown, Globe, ListFilter, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category } from '@/api/public-status';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/arc/drawer/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Switch } from '@/components/arc/switch/switch';
import { CountryFlag } from '@/components/country-flag';
import {
  type BillingFilter,
  clearNodeFilters,
  hasActiveNodeFilters,
  type NodeFacetCounts,
  type NodeFilterState,
  type NodeViewMode,
  type TagMatchMode,
} from '../node-filters';

const STATE_OPTIONS = [
  { value: 'online', label: '在线' },
  { value: 'offline', label: '离线' },
  { value: 'pending', label: '待注册' },
  { value: 'disabled', label: '已禁用' },
] as const;

const BILLING_LABELS: Record<Exclude<BillingFilter, 'all'>, string> = {
  soon: '7 天内到期',
  expired: '已到期',
  migration: '地址迁移待确认',
};

const VIEW_OPTIONS = [
  { value: 'table', label: '列表' },
  { value: 'grouped', label: '按分组' },
];

export default function NodeFilterBar({
  filters,
  counts,
  categories,
  matchedCount,
  totalCount,
  disabled,
  onChange,
}: {
  filters: NodeFilterState;
  counts: NodeFacetCounts;
  categories: Category[];
  matchedCount: number;
  totalCount: number;
  disabled: boolean;
  onChange: (next: NodeFilterState) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || disabled) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled]);

  const groups = useMemo(() => categories.filter((c) => c.kind === 'group'), [categories]);
  const tags = useMemo(() => categories.filter((c) => c.kind === 'tag'), [categories]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLocaleLowerCase();
    return q ? groups.filter((g) => g.name.toLocaleLowerCase().includes(q)) : groups;
  }, [groups, groupSearch]);

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLocaleLowerCase();
    return q ? tags.filter((t) => t.name.toLocaleLowerCase().includes(q)) : tags;
  }, [tags, tagSearch]);

  const extraCount = [
    filters.kind !== 'all',
    filters.country !== 'all',
    filters.engine !== 'all',
    filters.billing !== 'all',
    filters.sharedOnly,
  ].filter(Boolean).length;

  const mobileCount =
    filters.states.length + (filters.group !== 'all' ? 1 : 0) + filters.tags.length + extraCount;

  const active = hasActiveNodeFilters(filters);

  const selectedGroupLabel =
    filters.group === 'all'
      ? '分组'
      : filters.group === 'none'
        ? '分组：未分组'
        : `分组：${groups.find((g) => g.id === filters.group)?.name ?? filters.group}`;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.query.trim()) {
    chips.push({
      key: 'q',
      label: `搜索：${filters.query.trim()}`,
      onRemove: () => onChange({ ...filters, query: '' }),
    });
  }
  if (filters.states.length) {
    const labels = filters.states
      .map((s) => STATE_OPTIONS.find((o) => o.value === s)?.label ?? s)
      .join('、');
    chips.push({
      key: 'state',
      label: `状态：${labels}`,
      onRemove: () => onChange({ ...filters, states: [] }),
    });
  }
  if (filters.group !== 'all') {
    const name =
      filters.group === 'none'
        ? '未分组'
        : (groups.find((g) => g.id === filters.group)?.name ?? filters.group);
    chips.push({
      key: 'group',
      label: `分组：${name}`,
      onRemove: () => onChange({ ...filters, group: 'all' }),
    });
  }
  if (filters.tags.length) {
    const label = filters.tags.includes('none')
      ? '标签：无标签'
      : `标签（${filters.tagMode === 'all' ? '全部匹配' : '任一匹配'}）：${filters.tags
          .map((id) => tags.find((t) => t.id === id)?.name ?? id)
          .join('、')}`;
    chips.push({
      key: 'tag',
      label,
      onRemove: () => onChange({ ...filters, tags: [] }),
    });
  }
  if (filters.kind !== 'all') {
    chips.push({
      key: 'kind',
      label: `类型：${filters.kind === 'nat' ? 'NAT VPS' : '公网 VPS'}`,
      onRemove: () => onChange({ ...filters, kind: 'all' }),
    });
  }
  if (filters.country !== 'all') {
    const label =
      counts.countries.find((c) => c.code === filters.country)?.label ?? filters.country;
    chips.push({
      key: 'country',
      label: `地区：${label}`,
      onRemove: () => onChange({ ...filters, country: 'all' }),
    });
  }
  if (filters.engine !== 'all') {
    const label =
      filters.engine === 'none'
        ? '未安装引擎'
        : (counts.engines.find((e) => e.name === filters.engine)?.label ?? filters.engine);
    chips.push({
      key: 'engine',
      label: `引擎：${label}`,
      onRemove: () => onChange({ ...filters, engine: 'all' }),
    });
  }
  if (filters.billing !== 'all') {
    chips.push({
      key: 'billing',
      label: `维护：${BILLING_LABELS[filters.billing]}`,
      onRemove: () => onChange({ ...filters, billing: 'all' }),
    });
  }
  if (filters.sharedOnly) {
    chips.push({
      key: 'sharedOnly',
      label: '仅显示含公开分类',
      onRemove: () => onChange({ ...filters, sharedOnly: false }),
    });
  }

  return (
    <section
      aria-label="筛选条件"
      className="space-y-3 rounded-(--radius-panel) border-[1px] border-border bg-surface p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-52 flex-1">
          <SearchField
            ref={searchRef}
            hideLabel
            disabled={disabled}
            label="搜索节点"
            placeholder="节点名称、ID、IP、地区或分组标签（按 / 聚焦）"
            value={filters.query}
            onValueChange={(query) => onChange({ ...filters, query })}
          />
        </div>

        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" disabled={disabled}>
                <span>状态</span>
                {filters.states.length > 0 ? (
                  <Badge tone="info" pill>
                    {filters.states.length}
                  </Badge>
                ) : (
                  <ChevronDown size={15} className="text-text-muted" aria-hidden="true" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-3!">
              <div className="space-y-2">
                <p className="text-(length:--text-xs) font-medium text-text-secondary">
                  连接状态（可多选）
                </p>
                <div className="space-y-1.5">
                  {STATE_OPTIONS.map((opt) => (
                    <div key={opt.value} className="flex items-center justify-between gap-2">
                      <Checkbox
                        label={opt.label}
                        checked={filters.states.includes(opt.value)}
                        onCheckedChange={(checked) => {
                          const next =
                            checked === true
                              ? [...filters.states, opt.value]
                              : filters.states.filter((s) => s !== opt.value);
                          onChange({ ...filters, states: next });
                        }}
                      />
                      <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                        {counts.states[opt.value]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={groupOpen} onOpenChange={setGroupOpen}>
            <PopoverTrigger asChild>
              <Button variant="secondary" disabled={disabled}>
                <span className="max-w-36 truncate">{selectedGroupLabel}</span>
                <ChevronDown size={15} className="text-text-muted" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3!">
              <div className="space-y-2">
                <p className="text-(length:--text-xs) font-medium text-text-secondary">所属分组</p>
                {groups.length > 6 && (
                  <SearchField
                    hideLabel
                    label="筛选分组"
                    placeholder="搜索分组名称"
                    value={groupSearch}
                    onValueChange={setGroupSearch}
                  />
                )}
                <div className="max-h-60 space-y-1 overflow-y-auto">
                  {[
                    { id: 'all', name: '全部分组', count: counts.total },
                    { id: 'none', name: '未分组', count: counts.ungrouped },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onChange({ ...filters, group: item.id });
                        setGroupOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-(length:--text-xs) ${
                        filters.group === item.id
                          ? 'bg-(--accent-subtle) font-medium text-foreground'
                          : 'text-foreground hover:bg-surface-muted'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {filters.group === item.id && <Check size={14} aria-hidden="true" />}
                        <span>{item.name}</span>
                      </span>
                      <span className="text-text-secondary tabular-nums">{item.count}</span>
                    </button>
                  ))}
                  {groups.length > 0 && (
                    <div className="my-1 border-t-[1px] border-border-subtle" />
                  )}
                  {filteredGroups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        onChange({ ...filters, group: g.id });
                        setGroupOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-(length:--text-xs) ${
                        filters.group === g.id
                          ? 'bg-(--accent-subtle) font-medium text-foreground'
                          : 'text-foreground hover:bg-surface-muted'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {filters.group === g.id && (
                          <Check size={14} className="shrink-0" aria-hidden="true" />
                        )}
                        <span className="truncate">{g.name}</span>
                        {g.shared && (
                          <Globe
                            size={12}
                            className="shrink-0 text-success"
                            aria-label="在公开状态页展示"
                          />
                        )}
                      </span>
                      <span className="shrink-0 text-text-secondary tabular-nums">
                        {counts.groups[g.id] ?? 0}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" disabled={disabled}>
                <span>标签</span>
                {filters.tags.length > 0 ? (
                  <Badge tone="info" pill>
                    {filters.tags.includes('none')
                      ? '无'
                      : `${filters.tagMode === 'all' ? '且' : '或'} ${filters.tags.length}`}
                  </Badge>
                ) : (
                  <ChevronDown size={15} className="text-text-muted" aria-hidden="true" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3!">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-(length:--text-xs) font-medium text-text-secondary">
                    标签筛选
                  </span>
                  <SegmentedControl
                    label="标签匹配模式"
                    value={filters.tagMode}
                    onValueChange={(value) =>
                      onChange({ ...filters, tagMode: value as TagMatchMode })
                    }
                    options={[
                      { value: 'all', label: '匹配全部' },
                      { value: 'any', label: '匹配任一' },
                    ]}
                  />
                </div>
                {tags.length > 5 && (
                  <SearchField
                    hideLabel
                    label="筛选标签"
                    placeholder="搜索标签名称"
                    value={tagSearch}
                    onValueChange={setTagSearch}
                  />
                )}
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  <div className="flex items-center justify-between gap-2">
                    <Checkbox
                      label="无标签"
                      checked={filters.tags.includes('none')}
                      onCheckedChange={(checked) =>
                        onChange({ ...filters, tags: checked === true ? ['none'] : [] })
                      }
                    />
                    <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                      {counts.untagged}
                    </span>
                  </div>
                  {tags.length > 0 && <div className="my-1 border-t-[1px] border-border-subtle" />}
                  {filteredTags.map((tag) => (
                    <div key={tag.id} className="flex items-center justify-between gap-2">
                      <Checkbox
                        label={tag.name}
                        checked={filters.tags.includes(tag.id)}
                        onCheckedChange={(checked) => {
                          const base = filters.tags.filter((id) => id !== 'none');
                          const next =
                            checked === true
                              ? [...base, tag.id]
                              : base.filter((id) => id !== tag.id);
                          onChange({ ...filters, tags: next });
                        }}
                      />
                      <div className="flex shrink-0 items-center gap-1.5">
                        {tag.shared && (
                          <Globe size={12} className="text-success" aria-label="在公开状态页展示" />
                        )}
                        <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                          {counts.tags[tag.id] ?? 0}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" disabled={disabled}>
                <SlidersHorizontal size={15} aria-hidden="true" />
                <span>更多条件</span>
                {extraCount > 0 && (
                  <Badge tone="info" pill>
                    {extraCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-4!">
              <SecondaryFilterFields filters={filters} counts={counts} onChange={onChange} />
            </PopoverContent>
          </Popover>
        </div>

        <div className="sm:hidden">
          <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
            <DrawerTrigger asChild>
              <Button variant="secondary" disabled={disabled}>
                <ListFilter size={16} aria-hidden="true" />
                <span>筛选</span>
                {mobileCount > 0 && (
                  <Badge tone="info" pill>
                    {mobileCount}
                  </Badge>
                )}
              </Button>
            </DrawerTrigger>
            <DrawerContent
              side="bottom"
              title="筛选节点"
              footer={
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    disabled={!active}
                    onClick={() => onChange(clearNodeFilters(filters))}
                  >
                    清除筛选
                  </Button>
                  <Button variant="primary" onClick={() => setMobileOpen(false)}>
                    查看 {matchedCount} 台节点
                  </Button>
                </div>
              }
            >
              <div className="space-y-5">
                <div className="space-y-2">
                  <p className="text-(length:--text-xs) font-medium text-text-secondary">
                    连接状态
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {STATE_OPTIONS.map((opt) => (
                      <Checkbox
                        key={opt.value}
                        label={`${opt.label} (${counts.states[opt.value]})`}
                        checked={filters.states.includes(opt.value)}
                        onCheckedChange={(checked) => {
                          const next =
                            checked === true
                              ? [...filters.states, opt.value]
                              : filters.states.filter((s) => s !== opt.value);
                          onChange({ ...filters, states: next });
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-(length:--text-xs) font-medium text-text-secondary">
                    所属分组
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { value: 'all', label: `全部 (${counts.total})` },
                      { value: 'none', label: `未分组 (${counts.ungrouped})` },
                      ...groups.map((g) => ({
                        value: g.id,
                        label: `${g.name} (${counts.groups[g.id] ?? 0})`,
                      })),
                    ].map((opt) => (
                      <OptionChip
                        key={opt.value}
                        selected={filters.group === opt.value}
                        onClick={() => onChange({ ...filters, group: opt.value })}
                      >
                        {opt.label}
                      </OptionChip>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-(length:--text-xs) font-medium text-text-secondary">
                      节点标签
                    </span>
                    <SegmentedControl
                      label="标签匹配模式"
                      value={filters.tagMode}
                      onValueChange={(value) =>
                        onChange({ ...filters, tagMode: value as TagMatchMode })
                      }
                      options={[
                        { value: 'all', label: '匹配全部' },
                        { value: 'any', label: '匹配任一' },
                      ]}
                    />
                  </div>
                  <div className="space-y-2 rounded-(--radius-control) border-[1px] border-border-subtle p-2.5">
                    <Checkbox
                      label={`无标签 (${counts.untagged})`}
                      checked={filters.tags.includes('none')}
                      onCheckedChange={(checked) =>
                        onChange({ ...filters, tags: checked === true ? ['none'] : [] })
                      }
                    />
                    {tags.map((tag) => (
                      <Checkbox
                        key={tag.id}
                        label={`${tag.name} (${counts.tags[tag.id] ?? 0})`}
                        checked={filters.tags.includes(tag.id)}
                        onCheckedChange={(checked) => {
                          const base = filters.tags.filter((id) => id !== 'none');
                          const next =
                            checked === true
                              ? [...base, tag.id]
                              : base.filter((id) => id !== tag.id);
                          onChange({ ...filters, tags: next });
                        }}
                      />
                    ))}
                  </div>
                </div>
                <SecondaryFilterFields filters={filters} counts={counts} onChange={onChange} />
              </div>
            </DrawerContent>
          </Drawer>
        </div>

        <div className="ml-auto">
          <SegmentedControl
            label="视图模式"
            value={filters.view}
            onValueChange={(value) => onChange({ ...filters, view: value as NodeViewMode })}
            options={VIEW_OPTIONS}
          />
        </div>
      </div>

      {active && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t-[1px] border-border-subtle pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1 rounded-lg border-[1px] border-border bg-surface-raised py-1 pr-1 pl-2.5 text-(length:--text-xs) text-foreground"
              >
                <span className="wrap-anywhere">{chip.label}</span>
                <button
                  type="button"
                  onClick={chip.onRemove}
                  aria-label={`移除 ${chip.label}`}
                  className="rounded p-0.5 text-text-muted hover:text-foreground"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </span>
            ))}
            <Button variant="ghost" size="sm" onClick={() => onChange(clearNodeFilters(filters))}>
              清除全部
            </Button>
          </div>
          <span className="ml-auto text-(length:--text-xs) text-text-secondary tabular-nums">
            显示 {matchedCount} / {totalCount} 台节点
          </span>
        </div>
      )}
    </section>
  );
}

function OptionChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border-[1px] px-2.5 py-1 text-(length:--text-xs) tabular-nums ${
        selected
          ? 'border-(--table-row-selected-border) bg-(--accent-subtle) font-medium text-foreground'
          : 'border-border bg-surface text-text-secondary hover:bg-surface-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function SecondaryFilterFields({
  filters,
  counts,
  onChange,
}: {
  filters: NodeFilterState;
  counts: NodeFacetCounts;
  onChange: (next: NodeFilterState) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="block text-(length:--text-xs) font-medium text-text-secondary">
          节点类型
        </span>
        <SegmentedControl
          label="节点类型"
          value={filters.kind}
          onValueChange={(kind) => onChange({ ...filters, kind })}
          options={[
            { value: 'all', label: '全部' },
            { value: 'vps', label: `公网 (${counts.kinds.vps})` },
            { value: 'nat', label: `NAT (${counts.kinds.nat})` },
          ]}
        />
      </div>

      <div className="space-y-1.5">
        <span className="block text-(length:--text-xs) font-medium text-text-secondary">地区</span>
        {counts.countries.length === 0 ? (
          <p className="text-(length:--text-xs) text-text-secondary">暂无地区数据</p>
        ) : (
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            <OptionChip
              selected={filters.country === 'all'}
              onClick={() => onChange({ ...filters, country: 'all' })}
            >
              全部地区
            </OptionChip>
            {counts.countries.map((c) => (
              <OptionChip
                key={c.code}
                selected={filters.country === c.code}
                onClick={() =>
                  onChange({ ...filters, country: filters.country === c.code ? 'all' : c.code })
                }
              >
                <CountryFlag code={c.code} />
                <span>{c.label}</span>
                <span className="text-text-muted">{c.count}</span>
              </OptionChip>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <span className="block text-(length:--text-xs) font-medium text-text-secondary">
          代理引擎
        </span>
        <div className="flex flex-wrap gap-1.5">
          <OptionChip
            selected={filters.engine === 'all'}
            onClick={() => onChange({ ...filters, engine: 'all' })}
          >
            全部引擎
          </OptionChip>
          {counts.engines.map((e) => (
            <OptionChip
              key={e.name}
              selected={filters.engine === e.name}
              onClick={() =>
                onChange({ ...filters, engine: filters.engine === e.name ? 'all' : e.name })
              }
            >
              <span>{e.label}</span>
              <span className="text-text-muted">{e.count}</span>
            </OptionChip>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="block text-(length:--text-xs) font-medium text-text-secondary">
          维护与租期
        </span>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { value: 'all', label: '全部状态' },
              { value: 'soon', label: `7 天内到期 (${counts.billing.soon})` },
              { value: 'expired', label: `已到期 (${counts.billing.expired})` },
              { value: 'migration', label: `地址迁移待确认 (${counts.billing.migration})` },
            ] as const
          ).map((opt) => (
            <OptionChip
              key={opt.value}
              selected={filters.billing === opt.value}
              onClick={() => onChange({ ...filters, billing: opt.value })}
            >
              {opt.label}
            </OptionChip>
          ))}
        </div>
      </div>

      <Switch
        label="仅显示含公开展示分类的节点"
        checked={filters.sharedOnly}
        onCheckedChange={(sharedOnly) => onChange({ ...filters, sharedOnly })}
      />
    </div>
  );
}
