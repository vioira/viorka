import { Save } from 'lucide-react';
import type { PresetConfig, PresetImpactPreview } from '@/api/protocol-presets';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import EmptyStates from '@/components/empty-states';
import { StatusIndicator } from '@/components/node-status';

const fieldNames: Record<keyof PresetConfig, string> = {
  name: '配置名称',
  protocol: '协议',
  port: '默认端口',
  transport: '传输方式',
  security: '传输层安全',
  site: '握手站点',
  target: '握手目标',
  short_ids: 'Short ID',
  fingerprint: '客户端指纹',
  certificate: '源站证书',
  server_name: '默认 SNI',
  cdn_host: 'CDN 主机名',
  path: '传输路径',
};

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '未设置';
  const text = String(value ?? '');
  return text || '未设置';
}

export default function PresetImpactDialog({
  preview,
  saving,
  onClose,
  onSave,
  returnFocus,
}: {
  preview: PresetImpactPreview;
  saving: boolean;
  onClose: () => void;
  onSave: () => Promise<void>;
  returnFocus: () => void;
}) {
  const changed = (Object.keys(fieldNames) as (keyof PresetConfig)[]).filter(
    (key) => JSON.stringify(preview.before[key]) !== JSON.stringify(preview.config[key]),
  );

  const summary = preview.impacts.reduce(
    (acc, impact) => {
      if (impact.issue) acc.blocked++;
      else if (impact.draft_only || !impact.changed) acc.unchanged++;
      else if (impact.node_state === 'online') acc.onlineSync++;
      else acc.offlineSync++;
      return acc;
    },
    { onlineSync: 0, offlineSync: 0, unchanged: 0, blocked: 0 },
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        title="保存并同步协议配置"
        description="在线节点自动同步，离线节点上线后同步最新目标，未发布草稿不会自动发布。"
        className="[--dialog-width:800px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              返回编辑
            </Button>
            <Button type="button" disabled={saving} loading={saving} onClick={onSave}>
              <Save size={16} strokeWidth={1.75} aria-hidden="true" />
              确认保存并同步
            </Button>
          </>
        }
      >
        <div className="min-w-0 space-y-6">
          <section aria-label="参数变更对比" className="space-y-2.5">
            <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
              参数变更对比
            </h3>
            {changed.length === 0 ? (
              <EmptyStates compact headingLevel={3} title="配置内容未变化" />
            ) : (
              <dl className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background">
                {changed.map((key) => (
                  <div
                    key={key}
                    className="grid gap-1 px-3.5 py-2.5 text-(length:--text-xs) sm:grid-cols-[8rem_minmax(0,1fr)]"
                  >
                    <dt className="text-text-secondary">{fieldNames[key]}</dt>
                    <dd className="font-mono break-all tabular-nums text-foreground">
                      <span className="text-text-secondary">
                        {formatValue(preview.before[key])}
                      </span>
                      {' → '}
                      <span className="font-medium">{formatValue(preview.config[key])}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <dl className="grid grid-cols-2 divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background text-center sm:grid-cols-4 sm:divide-x-[1px] sm:divide-y-0">
            <div className="px-3 py-2.5">
              <dt className="text-(length:--text-xs) text-text-secondary">自动同步</dt>
              <dd className="mt-0.5 text-(length:--text-sm) font-medium tabular-nums text-success">
                {summary.onlineSync}
              </dd>
            </div>
            <div className="px-3 py-2.5">
              <dt className="text-(length:--text-xs) text-text-secondary">上线后同步</dt>
              <dd className="mt-0.5 text-(length:--text-sm) font-medium tabular-nums text-warning">
                {summary.offlineSync}
              </dd>
            </div>
            <div className="px-3 py-2.5">
              <dt className="text-(length:--text-xs) text-text-secondary">无变更或仅草稿</dt>
              <dd className="mt-0.5 text-(length:--text-sm) font-medium tabular-nums text-foreground">
                {summary.unchanged}
              </dd>
            </div>
            <div className="px-3 py-2.5">
              <dt className="text-(length:--text-xs) text-text-secondary">存在阻塞</dt>
              <dd
                className={`mt-0.5 text-(length:--text-sm) font-medium tabular-nums ${
                  summary.blocked > 0 ? 'text-danger' : 'text-foreground'
                }`}
              >
                {summary.blocked}
              </dd>
            </div>
          </dl>

          <section aria-label="受影响节点与服务" className="min-w-0 space-y-2.5">
            <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
              受影响节点与服务明细
            </h3>
            {preview.impacts.length === 0 ? (
              <p className="rounded-(--radius-control) border-[1px] border-border bg-background px-4 py-3 text-(length:--text-xs) text-text-secondary">
                当前没有节点引用此配置。
              </p>
            ) : (
              <ul className="divide-y-[1px] divide-border-subtle overflow-hidden rounded-(--radius-control) border-[1px] border-border">
                {preview.impacts.map((impact) => {
                  const actionLabel = impact.draft_only
                    ? '仅草稿引用，首次部署需应用'
                    : !impact.changed
                      ? '有效配置未变，无需同步'
                      : impact.issue
                        ? `无法同步：${impact.issue}`
                        : impact.node_state === 'online'
                          ? '保存后自动同步'
                          : '上线后同步最新目标';
                  const tone = impact.issue
                    ? 'danger'
                    : impact.changed && !impact.draft_only
                      ? impact.node_state === 'online'
                        ? 'success'
                        : 'warning'
                      : 'neutral';
                  return (
                    <li key={impact.engine_id} className="space-y-2.5 bg-surface p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <StatusIndicator
                            text={impact.node_name}
                            className={
                              impact.node_state === 'online'
                                ? 'font-medium text-success'
                                : 'font-medium text-text-secondary'
                            }
                          />
                          <span className="text-(length:--text-xs) text-text-secondary">
                            {impact.engine}
                          </span>
                        </div>
                        <Badge size="sm" tone={tone}>
                          {actionLabel}
                        </Badge>
                      </div>

                      <div className="space-y-2">
                        {impact.services.map((service) => (
                          <div
                            key={service.id}
                            className="space-y-1 rounded-(--radius-control) border-[1px] border-border-subtle bg-background px-3 py-2 text-(length:--text-xs)"
                          >
                            <p className="font-medium text-foreground wrap-anywhere">
                              {service.name}
                            </p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-secondary tabular-nums">
                              <span>
                                端口 {service.before_port} → {service.after_port}（
                                {service.port_overridden ? '节点独立覆盖' : '继承'}）
                              </span>
                              <span className="break-all">
                                SNI {service.before_sni || '未设置'} →{' '}
                                {service.after_sni || '未设置'}（
                                {service.sni_overridden ? '节点独立覆盖' : '继承'}）
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {impact.changed && !impact.draft_only && (
                        <p className="text-(length:--text-xs) text-text-secondary wrap-anywhere">
                          {impact.run_intent === 'stopped'
                            ? '引擎保持停止，仅更新配置。'
                            : '运行中的引擎可能重载或重启。'}
                          {impact.shared_services.length > 0 &&
                            ` 同引擎服务：${impact.shared_services.join('、')}`}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <p className="text-(length:--text-xs) text-text-secondary">
            配置校验或应用失败的节点保留失败状态，其余节点独立同步；Agent 确认成功后才标记已同步。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
