import type { PresetConfig, PresetImpactPreview } from '@/api/protocol-presets';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { SortableDataTable } from '@/components/arc/sortable-data-table/sortable-data-table';

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
  certificate: '证书',
  server_name: '默认 SNI',
  cdn_host: 'CDN 主机名',
  path: '传输路径',
};
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        title="保存并同步协议配置"
        description="在线节点自动同步；离线节点上线后同步最新配置。Agent 确认成功后才标记已同步。"
        className="[--dialog-width:800px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        footer={
          <>
            <Button variant="secondary" disabled={saving} onClick={onClose}>
              继续编辑
            </Button>
            <Button disabled={saving} loading={saving} onClick={onSave}>
              {saving ? '正在保存…' : '保存并同步'}
            </Button>
          </>
        }
      >
        <div className="min-w-0 space-y-6">
          <section aria-label="配置变化" className="space-y-3">
            <h2 className="font-medium">配置变化</h2>
            {changed.length === 0 ? (
              <p className="text-text-secondary">配置内容未变化。</p>
            ) : (
              <dl className="space-y-3">
                {changed.map((key) => (
                  <div key={key} className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
                    <dt className="text-text-secondary">{fieldNames[key]}</dt>
                    <dd className="break-all tabular-nums">
                      {String(preview.before[key]) || '未设置'} →{' '}
                      {String(preview.config[key]) || '未设置'}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section aria-label="受影响节点服务" className="min-w-0 space-y-3">
            <h2 className="font-medium">引用节点与服务</h2>
            <SortableDataTable
              rows={preview.impacts.map((impact) => ({ ...impact }))}
              rowKey="engine_id"
              caption="协议配置保存影响范围"
              emptyMessage="没有节点引用此配置。"
              columns={[
                {
                  key: 'node_name',
                  label: '节点',
                  render: (_, row) => (
                    <div className="space-y-1">
                      <p className="break-all">{row.node_name}</p>
                      <p className="text-(length:--text-xs) text-text-secondary">
                        {row.node_state === 'online' ? '在线' : '离线或尚未连接'} / {row.engine}
                      </p>
                    </div>
                  ),
                },
                {
                  key: 'services',
                  label: '引用服务与覆盖',
                  sortable: false,
                  render: (_, row) => (
                    <ul className="space-y-3">
                      {row.services.map((service) => (
                        <li key={service.id} className="space-y-1">
                          <p className="break-all">{service.name}</p>
                          <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
                            端口：{service.before_port} → {service.after_port}（
                            {service.port_overridden ? '节点独立值' : '继承'}）
                          </p>
                          <p className="break-all text-(length:--text-xs) text-text-secondary">
                            SNI：{service.before_sni} → {service.after_sni}（
                            {service.sni_overridden ? '节点独立值' : '继承'}）
                          </p>
                        </li>
                      ))}
                    </ul>
                  ),
                },
                {
                  key: 'changed',
                  label: '同步影响',
                  sortable: false,
                  render: (_, row) => (
                    <div className="space-y-2">
                      <p>
                        {row.draft_only
                          ? '仅草稿引用，首次部署仍需应用'
                          : !row.changed
                            ? '有效配置未变，无需同步'
                            : row.issue
                              ? `无法同步：${row.issue}`
                              : row.node_state === 'online'
                                ? '保存后自动同步'
                                : '上线后同步最新配置'}
                      </p>
                      {row.changed && (
                        <>
                          <p className="text-(length:--text-xs) text-text-secondary">
                            {row.run_intent === 'stopped'
                              ? '引擎保持停止，只更新配置。'
                              : '运行中的引擎可能重载或重启。'}
                          </p>
                          <p className="break-all text-(length:--text-xs) text-text-secondary">
                            同引擎服务：{row.shared_services.join('、')}
                          </p>
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </section>
          <p className="text-(length:--text-xs) text-text-secondary">
            不会发布节点中尚未应用的草稿编辑。配置校验或应用失败的节点保留失败状态，其他节点独立同步。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
