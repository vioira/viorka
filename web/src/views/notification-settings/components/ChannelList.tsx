import { Bell, Send } from 'lucide-react';
import type { AlertChannel, AlertSettings } from '@/api/alerts';
import { Button } from '@/components/arc/button/button';
import { deliveryLabel } from './delivery';

export default function ChannelList({
  data,
  disabled,
  onEdit,
  onDelete,
  onTest,
}: {
  data: AlertSettings;
  disabled: boolean;
  onEdit: (ch: AlertChannel) => void;
  onDelete: (ch: AlertChannel) => void;
  onTest: (id: string) => void;
}) {
  const { config, credentials, delivery } = data;
  return (
    <section className="space-y-4">
      <h2 className="font-medium text-foreground">外部推送渠道</h2>
      {!config.channels.length ? (
        <p className="rounded-(--radius-panel) border border-border bg-surface p-5 text-text-secondary">
          尚未添加外部推送渠道
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {config.channels.map((ch) => {
            const status = delivery[ch.id],
              refs = config.rules.filter((r) => r.channels.includes(ch.id)).length;
            return (
              <li
                key={ch.id}
                className="flex min-w-0 flex-col gap-4 rounded-(--radius-panel) border border-border bg-surface p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-all font-medium text-foreground">{ch.name}</h3>
                    <p className="break-all">
                      {ch.kind === 'telegram' ? 'Telegram' : 'Bark'}，{ch.target}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onEdit(ch)}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled || refs > 0}
                      onClick={() => onDelete(ch)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-border py-3">
                  <dt>渠道凭证</dt>
                  <dd>{credentials[ch.id] ? '已配置' : '待填写'}</dd>
                  <dt>最近投递</dt>
                  <dd className="break-words text-foreground">
                    {status ? deliveryLabel(status.state) : '暂无记录'}
                    {status && (
                      <p className="text-text-secondary">
                        {new Date(status.at).toLocaleString()} {status.detail}
                      </p>
                    )}
                  </dd>
                </dl>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <span>{refs ? `${refs} 条规则使用中` : '尚无规则使用'}</span>
                  <Button
                    variant="secondary"
                    disabled={disabled || !credentials[ch.id]}
                    onClick={() => onTest(ch.id)}
                  >
                    <Send size={16} aria-hidden="true" />
                    发送测试通知
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
        <div className="flex items-center gap-3">
          <Bell size={20} aria-hidden="true" />
          <div>
            <h3 className="font-medium text-foreground">站内通知中心</h3>
            <p>告警事件显示在顶部铃铛，已读状态按用户保存。</p>
          </div>
        </div>
        <span>常驻开启</span>
      </div>
    </section>
  );
}
