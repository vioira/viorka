import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { type BackupPolicy, getBackupPolicy, saveBackupPolicy } from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { PasswordField } from '@/components/arc/password-field/password-field';
import { Switch } from '@/components/arc/switch/switch';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import SettingsSection from './SettingsSection';

export default function BackupPolicyForm() {
  const session = useOutletContext<Session>();
  const admin = session.user.role === 'admin';
  const [policy, setPolicy] = useState<BackupPolicy | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useToastFeedback('error');
  const [, setNotice] = useToastFeedback('success');
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    getBackupPolicy(controller.signal)
      .then(setPolicy)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '无法读取备份配置，请重试。');
      });
    return () => controller.abort();
  }, [admin, setError]);
  async function reload() {
    try {
      setPolicy(await getBackupPolicy());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取备份配置，请重试。');
    }
  }
  async function save() {
    if (!policy || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      setPolicy(await saveBackupPolicy(session, policy));
      setNotice('备份配置已保存。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试。');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function s3(values: Partial<BackupPolicy['s3']>) {
    setPolicy((p) => p && { ...p, s3: { ...p.s3, ...values } });
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="space-y-4"
      aria-busy={pending}
    >
      <SettingsSection title="备份计划">
        {!policy && (
          <p className="text-text-secondary">
            {!admin ? '仅管理员可管理备份。' : error ? '尚未读取配置' : '正在加载配置…'}
          </p>
        )}
        <fieldset disabled={!policy || !admin || pending} className="min-w-0 space-y-5">
          <div className="flex min-h-11 items-center justify-between gap-4">
            <span id="backup-enabled">自动备份</span>
            <Switch
              aria-labelledby="backup-enabled"
              checked={policy?.enabled ?? false}
              onCheckedChange={(enabled) => setPolicy((p) => p && { ...p, enabled })}
            />
          </div>
          <Input
            label="Cron 表达式"
            value={policy?.cron ?? ''}
            required
            maxLength={128}
            onChange={(event) => setPolicy((p) => p && { ...p, cron: event.target.value })}
            description="5 段格式，例如 0 2 * * * 表示每天凌晨 2 点。执行时区为 UTC。"
          />
          <div className="grid gap-5 md:grid-cols-2">
            <Input
              label="保留天数"
              type="number"
              min={0}
              max={36500}
              step={1}
              required
              className="tabular-nums"
              value={policy?.retention_days ?? ''}
              onChange={(event) =>
                setPolicy((p) => p && { ...p, retention_days: event.target.valueAsNumber })
              }
              description="超期删除，0 不限天数，仍受份数限制。"
            />
            <Input
              label="最多保留"
              type="number"
              min={0}
              max={10000}
              step={1}
              required
              className="tabular-nums"
              value={policy?.max_copies ?? ''}
              onChange={(event) =>
                setPolicy((p) => p && { ...p, max_copies: event.target.valueAsNumber })
              }
              description="超额删除，0 不限份数，仍受天数限制。待恢复备份不会删除。"
            />
          </div>
        </fieldset>
      </SettingsSection>
      <SettingsSection
        title="存储位置"
        description="默认保存至本地。启用 S3 后另存加密副本，本地副本仍用于下载与恢复。"
      >
        <fieldset disabled={!policy || !admin || pending} className="min-w-0 space-y-5">
          <div className="flex min-h-11 items-center justify-between gap-4">
            <span id="backup-s3">S3 存储（可选）</span>
            <Switch
              aria-labelledby="backup-s3"
              checked={policy?.s3.enabled ?? false}
              onCheckedChange={(enabled) => s3({ enabled })}
            />
          </div>
          {policy?.s3.enabled && (
            <>
              <Input
                label="Endpoint"
                type="url"
                value={policy.s3.endpoint}
                onChange={(event) => s3({ endpoint: event.target.value })}
                description="留空使用 AWS S3；兼容存储填写 HTTPS 地址。"
              />
              <div className="grid gap-5 md:grid-cols-2">
                <Input
                  label="Region"
                  required
                  value={policy.s3.region}
                  onChange={(event) => s3({ region: event.target.value })}
                />
                <Input
                  label="Bucket"
                  required
                  value={policy.s3.bucket}
                  onChange={(event) => s3({ bucket: event.target.value })}
                />
              </div>
              <Input
                label="路径前缀"
                value={policy.s3.prefix}
                onChange={(event) => s3({ prefix: event.target.value })}
                description="可留空。请为当前面板使用独立前缀。"
              />
              <Input
                label="Access Key ID"
                required
                autoComplete="off"
                value={policy.s3.access_key}
                onChange={(event) => s3({ access_key: event.target.value })}
              />
              <PasswordField
                label="Secret Access Key"
                autoComplete="new-password"
                required={!policy.s3.secret_configured}
                value={policy.s3.secret_key ?? ''}
                onChange={(event) => s3({ secret_key: event.target.value })}
                placeholder={policy.s3.secret_configured ? '已配置，留空保留' : undefined}
                messages={{ showPassword: '显示密钥', hidePassword: '隐藏密钥' }}
              />
              <div className="flex min-h-11 items-center justify-between gap-4">
                <span id="backup-path-style">Path-style 寻址</span>
                <Switch
                  aria-labelledby="backup-path-style"
                  checked={policy.s3.path_style}
                  onCheckedChange={(path_style) => s3({ path_style })}
                />
              </div>
            </>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-3 justify-end">
          <Button variant="ghost" type="button" disabled={!admin || pending} onClick={reload}>
            重新读取配置
          </Button>
          <Button type="submit" disabled={!policy || !admin || pending} loading={pending}>
            保存备份配置
          </Button>
        </div>
      </SettingsSection>
    </form>
  );
}
