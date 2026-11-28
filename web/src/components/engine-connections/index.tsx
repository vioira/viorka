import { ArrowUpRight, Check, Copy, Globe, QrCode, Waypoints } from 'lucide-react';
import { type ReactNode, useId, useMemo, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Link } from 'react-router';
import { type Connection, engineStatus } from '@/api/engines';
import type { RelayRoute } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EmptyStates from '@/components/empty-states';
import {
  endpointText,
  isNatMapped,
  relayRoutePath,
  relayStatusLabel,
  relayTone,
} from '@/components/proxy/relay-meta';
import {
  buildRelayConnectionUrl,
  classifyRelayOptions,
  extractConnectionEndpoint,
  relayFragmentName,
} from './relay-link';

function ConnectionDetails({
  connection,
  relays,
  online,
  defaultShowQr,
  onNavigateAway,
  actions,
}: {
  connection: Connection;
  relays: RelayRoute[];
  online: boolean;
  defaultShowQr: boolean;
  onNavigateAway: () => void;
  actions?: ReactNode;
}) {
  const { toast } = useToastStack();
  const [selectedEntry, setSelectedEntry] = useState<'direct' | string>('direct');
  const [showQr, setShowQr] = useState(defaultShowQr);
  const linkRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const qrId = useId();

  const relayOptions = useMemo(() => classifyRelayOptions(relays), [relays]);
  const directEndpoint = useMemo(() => extractConnectionEndpoint(connection.url), [connection.url]);

  const activeRelayOption = useMemo(
    () =>
      selectedEntry === 'direct'
        ? null
        : (relayOptions.find((item) => item.route.id === selectedEntry && item.selectable) ?? null),
    [relayOptions, selectedEntry],
  );

  const activeUrl = useMemo(() => {
    if (!activeRelayOption?.endpoint) return connection.url;
    const path =
      activeRelayOption.route.serving_path ??
      activeRelayOption.route.published ??
      activeRelayOption.route.draft;
    return buildRelayConnectionUrl(
      connection.url,
      activeRelayOption.endpoint,
      relayFragmentName(activeRelayOption.route, path.name),
    );
  }, [activeRelayOption, connection.url]);

  const activeLabel = activeRelayOption
    ? activeRelayOption.route.draft.name
    : `${connection.name}（节点直连）`;

  async function copyLink(button: HTMLButtonElement) {
    try {
      await navigator.clipboard.writeText(activeUrl);
      toast({
        id: 'engine-connection-copy',
        type: 'success',
        title: activeRelayOption ? '中转连接链接已复制' : '直连连接链接已复制',
      });
    } catch {
      if (document.activeElement === button) {
        linkRef.current?.focus();
        linkRef.current?.select();
      }
      toast({
        id: 'engine-connection-copy',
        type: 'error',
        title: '无法复制链接',
        description: '请选择连接链接并手动复制。',
      });
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="grid min-w-0 gap-4 [&+section]:border-t-[1px] [&+section]:border-border [&+section]:pt-5"
    >
      <header className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={headingId} className="font-medium text-foreground wrap-anywhere">
            {connection.name}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-(length:--text-xs) text-text-secondary">
            <span className="font-mono tabular-nums">修订 r{connection.revision}</span>
            <span role="status">
              {online ? engineStatus(connection.runtime_status) : '节点离线，运行状态未确认'}
            </span>
          </div>
        </div>
      </header>

      {relayOptions.length > 0 && (
        <div className="space-y-2">
          <p className="text-(length:--text-xs) font-medium text-text-secondary">选择接入入口</p>
          <div
            role="radiogroup"
            aria-label={`${connection.name} 的接入入口`}
            className="divide-y-[1px] divide-border-subtle overflow-hidden rounded-(--radius-control) border-[1px] border-border bg-surface"
          >
            {/* Direct entry option */}
            <button
              type="button"
              role="radio"
              aria-checked={activeRelayOption === null}
              onClick={() => setSelectedEntry('direct')}
              className={`flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors ${
                activeRelayOption === null ? 'bg-surface-muted' : 'bg-surface hover:bg-background'
              }`}
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Globe
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 text-text-secondary"
                    aria-hidden="true"
                  />
                  <span className="text-(length:--text-sm) font-medium text-foreground">
                    节点直连
                  </span>
                  <Badge size="sm" tone="neutral">
                    源节点
                  </Badge>
                </div>
                <p className="font-mono text-(length:--text-xs) text-text-secondary tabular-nums wrap-anywhere">
                  {directEndpoint || '已登记公网入口'}
                </p>
              </div>
              {activeRelayOption === null && (
                <Check
                  size={16}
                  strokeWidth={1.75}
                  className="mt-0.5 shrink-0 text-accent"
                  aria-hidden="true"
                />
              )}
            </button>

            {/* Relay entry options */}
            {relayOptions.map((option) => {
              const { route, endpoint, selectable, caveat } = option;
              const isSelected = activeRelayOption?.route.id === route.id;
              const path = route.serving_path ?? route.published ?? route.draft;
              const nat = isNatMapped(path);
              return (
                <div
                  key={route.id}
                  className={`flex items-start justify-between gap-2 transition-colors ${
                    isSelected ? 'bg-surface-muted' : 'bg-surface'
                  }`}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={!selectable}
                    onClick={() => setSelectedEntry(route.id)}
                    className={`flex min-w-0 flex-1 items-start justify-between gap-3 px-3.5 py-2.5 text-left ${
                      selectable ? 'hover:bg-background/60' : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Waypoints
                          size={14}
                          strokeWidth={1.75}
                          className="shrink-0 text-text-secondary"
                          aria-hidden="true"
                        />
                        <span className="truncate text-(length:--text-sm) font-medium text-foreground">
                          {route.draft.name}
                        </span>
                        <Badge size="sm" dot tone={relayTone(route)}>
                          {relayStatusLabel(route)}
                        </Badge>
                        {nat && (
                          <Badge size="sm" tone="info">
                            NAT
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-(length:--text-xs) text-text-secondary">
                        <span>入口 {route.entry_name}</span>
                        {endpoint && (
                          <span className="font-mono tabular-nums wrap-anywhere">
                            {endpointText(endpoint)}
                          </span>
                        )}
                      </div>
                      {!selectable && (
                        <p className="text-(length:--text-xs) text-text-muted">{caveat}</p>
                      )}
                    </div>
                    {isSelected && (
                      <Check
                        size={16}
                        strokeWidth={1.75}
                        className="mt-0.5 shrink-0 text-accent"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                  {!selectable && (
                    <Link
                      to={relayRoutePath(route.id)}
                      onClick={onNavigateAway}
                      className="mt-2.5 mr-3 inline-flex shrink-0 items-center gap-0.5 text-(length:--text-xs) font-medium text-accent hover:underline"
                    >
                      查看
                      <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <Input
            ref={linkRef}
            label={
              activeRelayOption
                ? `中转连接链接（${activeRelayOption.route.draft.name}）`
                : '直连连接链接'
            }
            value={activeUrl}
            readOnly
            spellCheck={false}
            className="font-mono text-(length:--text-xs)"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" onClick={(event) => void copyLink(event.currentTarget)}>
            <Copy size={16} aria-hidden="true" />
            复制链接
          </Button>
        </div>
        <p role="status" className="text-(length:--text-xs) text-text-secondary">
          {activeRelayOption
            ? activeRelayOption.caveat
            : '直连使用节点原公网入口，外部连通尚未验证。'}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={showQr}
          aria-controls={qrId}
          onClick={() => setShowQr((visible) => !visible)}
        >
          <QrCode size={16} aria-hidden="true" />
          {showQr ? '收起二维码' : '显示二维码'}
        </Button>
        {actions}
      </div>

      <div id={qrId} hidden={!showQr}>
        {showQr && (
          <figure className="grid justify-items-center gap-2.5 rounded-(--radius-control) border-[1px] border-border bg-background p-4">
            {/* A white quiet zone is part of the scannable image in both themes. */}
            <div className="w-52 max-w-full rounded-(--radius-control) bg-white p-4">
              <QRCode
                className="block h-auto w-full"
                value={activeUrl}
                size={184}
                role="img"
                aria-label={`${activeLabel} 的连接二维码`}
              />
            </div>
            <figcaption className="text-center text-(length:--text-xs) text-text-secondary wrap-anywhere">
              {activeRelayOption
                ? `使用客户端扫码导入中转入口（${endpointText(activeRelayOption.endpoint)}）`
                : `使用客户端扫码导入直连入口${directEndpoint ? `（${directEndpoint}）` : ''}`}
            </figcaption>
          </figure>
        )}
      </div>
    </section>
  );
}

export default function EngineConnectionsDialog({
  connections,
  relays = [],
  online,
  onClose,
  returnFocus,
  renderActions,
}: {
  connections: Connection[] | null;
  relays?: RelayRoute[];
  online: boolean;
  onClose: () => void;
  returnFocus: HTMLElement | null;
  renderActions?: (connection: Connection) => ReactNode;
}) {
  const singleService = connections?.length === 1;

  return (
    <Dialog
      open={connections !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="已应用连接信息"
        description="链接和二维码均含客户端凭证，请妥善保管。"
        className="[--dialog-width:600px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus?.focus();
        }}
      >
        {connections?.length === 0 ? (
          <EmptyStates
            variant="unconfigured"
            title="暂无连接信息"
            description="所选服务尚无已应用版本，或未登记对外入口。"
          />
        ) : (
          <div className="grid gap-5">
            {connections?.map((item) => (
              <ConnectionDetails
                key={item.service_id}
                connection={item}
                relays={relays.filter((r) => r.draft.landing_service_id === item.service_id)}
                online={online}
                defaultShowQr={Boolean(singleService)}
                onNavigateAway={onClose}
                actions={renderActions?.(item)}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
