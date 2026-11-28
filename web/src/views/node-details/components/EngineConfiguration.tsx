import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineDraft } from '@/api/engines';
import {
  allOutbounds,
  defaultRouting,
  type Outbound,
  type EngineRouting as Routing,
} from '@/api/outbounds';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EngineOutbounds from './EngineOutbounds';
import EngineRouting from './EngineRouting';

const singBoxTabs = {
  services: '代理服务',
  outbounds: '共享出口',
  routing: '分流规则',
} as const;
type SingBoxView = keyof typeof singBoxTabs;

const realmTabs = {
  relays: '托管中转线路',
  manual: '手动转发规则',
} as const;
type RealmView = keyof typeof realmTabs;

export default function EngineConfiguration({
  draft,
  active,
  engineName,
  serviceEditorOpen,
  disabled,
  services,
  realmRelays,
  managedRelayCount = 0,
  manualRuleCount = 0,
  onRoutingChange,
}: {
  draft: EngineDraft;
  active: boolean;
  engineName: string;
  serviceEditorOpen: boolean;
  disabled: boolean;
  services: ReactNode;
  realmRelays?: ReactNode;
  managedRelayCount?: number;
  manualRuleCount?: number;
  onRoutingChange: (routing: Routing) => void;
}) {
  const { toast } = useToastStack();
  const supportsRouting = engineName === 'sing-box';
  const supportsRealmTabs = engineName === 'realm' && realmRelays !== undefined;
  const [view, setView] = useState<SingBoxView>('services');
  const [realmView, setRealmView] = useState<RealmView>('relays');
  const tabBar = useRef<HTMLDivElement>(null);
  const [catalog, setCatalog] = useState<Outbound[] | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const items = await allOutbounds(controller.signal);
      if (!controller.signal.aborted) setCatalog(items);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast({
          id: 'node-outbounds',
          type: 'error',
          title: '未能读取共享出口',
          description: error instanceof Error ? error.message : '请刷新出口列表。',
        });
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [toast]);

  const showOutbounds = active && supportsRouting && view !== 'services';
  useEffect(() => {
    if (!showOutbounds) return;
    void load();
    return () => request.current?.abort();
  }, [load, showOutbounds]);

  useEffect(() => {
    if (serviceEditorOpen) {
      setView('services');
      setRealmView('manual');
    }
  }, [serviceEditorOpen]);

  const routing = draft.routing
    ? {
        ...draft.routing,
        outbound_ids: draft.routing.outbound_ids ?? [],
        rules: draft.routing.rules ?? [],
      }
    : defaultRouting();
  const catalogById = useMemo(
    () => new Map(catalog?.map((outbound) => [outbound.id, outbound])),
    [catalog],
  );
  const counts = {
    services: draft.services.filter((service) => !service.pending_delete).length,
    outbounds: routing.outbound_ids.length,
    routing: routing.rules.length,
  };
  const realmCounts = {
    relays: managedRelayCount,
    manual: manualRuleCount,
  };
  const surface =
    '@container min-w-0 rounded-(--radius-panel) border-[1px] border-border bg-surface';
  const gutters = 'min-w-0 px-4 pb-4 @min-[40rem]:px-6 @min-[40rem]:pb-6';

  if (supportsRealmTabs) {
    return (
      <Tabs
        value={realmView}
        onValueChange={(value) => setRealmView(value as RealmView)}
        className={surface}
      >
        <div className="border-b-[1px] border-border px-2 pt-2">
          <TabsList aria-label="Realm 转发类型" borderless>
            {(Object.keys(realmTabs) as RealmView[]).map((tab) => (
              <TabsTrigger key={tab} value={tab} className="group/config-tab">
                <span className="inline-flex items-baseline gap-1.5 text-text-secondary group-data-[state=active]/config-tab:text-foreground">
                  {realmTabs[tab]}
                  {realmCounts[tab] > 0 && (
                    <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                      {realmCounts[tab]}
                    </span>
                  )}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="relays" className={gutters}>
          {realmRelays}
        </TabsContent>
        <TabsContent value="manual" className={gutters}>
          {services}
        </TabsContent>
      </Tabs>
    );
  }

  if (!supportsRouting) {
    return (
      <section
        className={surface}
        aria-label={engineName === 'realm' ? 'TCP 转发规则' : '代理服务'}
      >
        <div className={`${gutters} pt-4`}>{services}</div>
      </section>
    );
  }

  return (
    <Tabs value={view} onValueChange={(value) => setView(value as SingBoxView)} className={surface}>
      <div ref={tabBar} className="border-b-[1px] border-border px-2 pt-2">
        <TabsList aria-label="引擎配置项" borderless>
          {(Object.keys(singBoxTabs) as SingBoxView[]).map((tab) => (
            <TabsTrigger key={tab} value={tab} className="group/config-tab">
              <span className="inline-flex items-baseline gap-1.5 text-text-secondary group-data-[state=active]/config-tab:text-foreground">
                {singBoxTabs[tab]}
                {counts[tab] > 0 && (
                  <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                    {counts[tab]}
                  </span>
                )}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="services" className={gutters}>
        {services}
      </TabsContent>
      <TabsContent value="outbounds" className={gutters}>
        {active && view === 'outbounds' && (
          <EngineOutbounds
            routing={routing}
            catalog={catalog}
            catalogById={catalogById}
            loading={loading}
            disabled={disabled}
            onRefresh={load}
            onViewRouting={() => {
              setView('routing');
              tabBar.current?.querySelector<HTMLElement>('[data-value="routing"]')?.focus();
            }}
            onChange={onRoutingChange}
          />
        )}
      </TabsContent>
      <TabsContent value="routing" className={gutters}>
        {active && view === 'routing' && (
          <EngineRouting
            routing={routing}
            services={draft.services}
            catalogById={catalogById}
            catalogLoaded={catalog !== null}
            loading={loading}
            disabled={disabled}
            onRefresh={load}
            onChange={onRoutingChange}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
