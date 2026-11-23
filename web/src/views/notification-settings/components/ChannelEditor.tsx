import { useState } from 'react';
import type { AlertChannel } from '@/api/alerts';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
export default function ChannelEditor({
  initial,
  hasSecret,
  pending,
  cancel,
  save,
}: {
  initial: AlertChannel;
  hasSecret: boolean;
  pending: boolean;
  cancel: () => void;
  save: (v: AlertChannel, secret: string) => void;
}) {
  const [v, set] = useState(initial);
  const [secret, setSecret] = useState('');
  const tg = v.kind === 'telegram';
  const needsSecret = !hasSecret || v.kind !== initial.kind || (!tg && v.target !== initial.target);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(v, secret);
      }}
    >
      <fieldset disabled={pending} className="space-y-4">
        <Input
          label="渠道名称"
          required
          maxLength={100}
          value={v.name}
          onChange={(e) => set({ ...v, name: e.target.value })}
        />
        <Select
          label="渠道类型"
          options={[
            { value: 'telegram', label: 'Telegram' },
            { value: 'bark', label: 'Bark' },
          ]}
          value={v.kind}
          onValueChange={(k) => {
            set({
              ...v,
              kind: k as AlertChannel['kind'],
              target: k === 'bark' ? 'https://api.day.app' : '',
            });
            setSecret('');
          }}
        />
        <Input
          label={tg ? 'Chat ID' : 'Bark 服务地址'}
          type={tg ? 'text' : 'url'}
          required
          description={tg ? '填写会话 ID 或频道用户名。' : '填写官方或自建服务的 HTTPS 地址。'}
          value={v.target}
          onChange={(e) => set({ ...v, target: e.target.value })}
        />
        <Input
          label={tg ? 'Bot Token' : '设备 Key'}
          type="password"
          autoComplete="new-password"
          required={needsSecret}
          description={needsSecret ? undefined : '已保存凭证，留空继续使用。'}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        {hasSecret && (v.kind !== initial.kind || v.target !== initial.target) && (
          <p className="text-text-secondary">保存新的接收目标会取消该渠道尚未发出的通知。</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending}>
            保存渠道
          </Button>
          <Button type="button" variant="secondary" onClick={cancel}>
            取消
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
