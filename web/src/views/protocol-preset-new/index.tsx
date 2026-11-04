import { ArrowLeft } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { createProtocolPreset, type PresetConfig } from '@/api/protocol-presets';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import PresetFields, { type ShortIDField } from './components/PresetFields';
import PresetPreview from './components/PresetPreview';

export default function NewProtocolPresetPage() {
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const { toast } = useToastStack();
  const [value, setValue] = useState<PresetConfig>({
    name: '',
    protocol: 'vless',
    port: 443,
    transport: 'xhttp',
    security: 'reality',
    site: 'local',
    target: '',
    short_ids: [],
    fingerprint: 'chrome',
    certificate: '',
    server_name: '',
    cdn_host: '',
    path: '/',
  });
  const [shortIDs, setShortIDs] = useState<ShortIDField[]>([]);
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);
  const referenceable =
    value.transport === 'tcp' &&
    value.security === 'reality' &&
    value.site === 'external' &&
    value.fingerprint === 'chrome' &&
    shortIDs.length === 0;
  async function save() {
    if (locked.current) return;
    const ids = shortIDs.map((field) => field.value.trim().toLowerCase());
    const errors = [];
    if (!value.name.trim()) errors.push('填写配置名称');
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)
      errors.push('端口须为 1 至 65535');
    if (
      ids.length > 8 ||
      ids.some((id) => !/^(?:[0-9a-f]{2}){1,8}$/.test(id)) ||
      new Set(ids).size !== ids.length
    )
      errors.push('Short ID 须为不重复的偶数位十六进制，最多 8 个');
    if (
      value.security === 'reality' &&
      value.site === 'external' &&
      (!value.target || !value.server_name)
    )
      errors.push('填写握手目标和服务器名称');
    if (value.certificate === 'self_signed' && !value.cdn_host)
      errors.push('自签名证书需要 CDN 主机名');
    if (value.transport !== 'tcp' && !value.path.startsWith('/'))
      errors.push('传输路径须以 / 开头');
    if (errors.length) {
      toast({
        id: 'preset-validation',
        type: 'error',
        title: '请检查协议参数',
        description: errors.join('；'),
      });
      return;
    }
    locked.current = true;
    setSaving(true);
    try {
      await createProtocolPreset({ ...value, name: value.name.trim(), short_ids: ids }, session);
      toast({
        type: 'success',
        title: '协议配置已创建',
        description: '已保存预设，尚未部署到节点。',
      });
      await navigate('/protocol-presets');
    } catch (error) {
      toast({
        id: 'preset-save',
        type: 'error',
        title: '未能创建协议配置',
        description: error instanceof Error ? error.message : '请检查配置后重试。',
      });
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <header className="flex items-center gap-4">
        <Button
          className="size-11 shrink-0 p-0"
          variant="secondary"
          aria-label="返回协议配置"
          onClick={() => navigate('/protocol-presets')}
        >
          <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Button>
        <div>
          <h1 className="text-(length:--text-xl) font-medium">新建协议配置</h1>
          <p className="mt-1 text-(length:--text-xs) text-text-secondary">VLESS</p>
        </div>
      </header>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="min-w-0"
        aria-busy={saving}
      >
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <fieldset
            disabled={saving || session.user.role === 'viewer'}
            className="min-w-0 space-y-5"
          >
            <legend className="sr-only">VLESS 配置</legend>
            <PresetFields
              value={value}
              setValue={setValue}
              shortIDs={shortIDs}
              setShortIDs={setShortIDs}
            />
          </fieldset>
          <PresetPreview value={value} referenceable={referenceable} />
        </div>
        <footer className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-panel) border-[0.5px] border-border bg-surface px-5 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-medium wrap-anywhere">{value.name || 'VLESS'}</p>
            <p className="mt-1 text-(length:--text-xs) text-text-secondary">
              保存预设，稍后从节点引用
            </p>
          </div>
          <Button
            type="submit"
            className="min-h-11 shrink-0 [--button-primary-background:var(--accent)] [--button-primary-shadow:none] [--button-primary-foreground:var(--background)]"
            disabled={saving || session.user.role === 'viewer'}
          >
            {saving ? '正在创建…' : '创建协议配置'}
          </Button>
        </footer>
      </form>
    </>
  );
}
