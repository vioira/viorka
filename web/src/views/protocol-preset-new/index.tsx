import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import type { Session } from '@/api/auth';
import {
  createProtocolPreset,
  getProtocolPreset,
  type PresetConfig,
  type PresetImpactPreview,
  previewProtocolPreset,
  updateProtocolPreset,
} from '@/api/protocol-presets';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import PresetFields, { type ShortIDField, targetServerName } from './components/PresetFields';
import PresetImpactDialog from './components/PresetImpactDialog';
import PresetPreview from './components/PresetPreview';

export default function NewProtocolPresetPage() {
  const { presetId } = useParams();
  const [digest, setDigest] = useState('');
  const [loading, setLoading] = useState(Boolean(presetId));
  const [impact, setImpact] = useState<PresetImpactPreview | null>(null);
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const { toast } = useToastStack();
  const [formValue, setValue] = useState<PresetConfig>({
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
  const value =
    formValue.security === 'reality' && formValue.site === 'external'
      ? { ...formValue, server_name: targetServerName(formValue.target) }
      : formValue;
  const [shortIDs, setShortIDs] = useState<ShortIDField[]>([]);
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!presetId) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const preset = await getProtocolPreset(presetId, abort.signal);
      if (abort.signal.aborted) return;
      setValue(preset.config);
      setDigest(preset.digest);
      setImpact(null);
      setShortIDs(preset.config.short_ids.map((value, index) => ({ id: index, value })));
    } catch (error) {
      if (!abort.signal.aborted)
        toast({
          id: 'preset-load',
          type: 'error',
          title: '未能读取协议配置',
          description: error instanceof Error ? error.message : '请重新读取配置后重试。',
        });
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }, [presetId, toast]);
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);
  async function confirmSave() {
    if (!presetId || !impact || locked.current) return;
    locked.current = true;
    setSaving(true);
    try {
      await updateProtocolPreset(
        presetId,
        { config: impact.config, base_digest: digest, confirmation: impact.confirmation },
        session,
      );
      toast({
        id: 'preset-save',
        type: 'success',
        title: '协议配置已保存',
        description: '有变化的引擎将自动同步；离线节点上线后同步。请在节点页面查看实际结果。',
      });
      setImpact(null);
      await navigate('/protocol-presets');
    } catch (error) {
      toast({
        id: 'preset-save',
        type: 'error',
        title: '未能保存协议配置',
        description: error instanceof Error ? error.message : '请重新预览影响范围后重试。',
      });
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  const ids = shortIDs.map((field) => field.value.trim().toLowerCase()).filter(Boolean);
  const referenceable =
    value.transport === 'tcp' &&
    value.security === 'reality' &&
    value.site === 'external' &&
    value.fingerprint === 'chrome' &&
    ids.length <= 8 &&
    ids.every((id) => /^(?:[0-9a-f]{2}){1,8}$/.test(id)) &&
    new Set(ids).size === ids.length;
  async function save() {
    if (locked.current || loading || (presetId && !digest)) return;
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
      errors.push('握手目标须填写域名和端口，例如 www.example.org:443');
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
      if (presetId) {
        const preview = await previewProtocolPreset(
          presetId,
          {
            config: { ...value, name: value.name.trim(), short_ids: ids },
            base_digest: digest,
            confirmation: '',
          },
          session,
        );
        setImpact(preview);
        return;
      }
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
        title: presetId ? '未能预览配置影响' : '未能创建协议配置',
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
          <h1 className="text-(length:--text-xl) font-medium">
            {presetId ? '编辑协议配置' : '新建协议配置'}
          </h1>
          <p className="mt-1 text-(length:--text-xs) text-text-secondary">VLESS</p>
        </div>
        {presetId && (
          <Button
            variant="secondary"
            className="ml-auto min-h-11"
            disabled={saving || loading}
            onClick={() => void load()}
          >
            {loading ? '正在读取…' : '重新读取配置'}
          </Button>
        )}
      </header>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="min-w-0 pb-36 sm:pb-28"
        aria-busy={saving || loading}
      >
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <fieldset
            disabled={
              saving || loading || Boolean(presetId && !digest) || session.user.role === 'viewer'
            }
            className="min-w-0"
          >
            <legend className="sr-only">VLESS 配置</legend>
            <div className="min-w-0 space-y-5">
              {presetId && !digest ? (
                <div
                  className="min-h-96 rounded-(--radius-panel) border-[1px] border-border bg-surface p-6"
                  role="status"
                >
                  {loading ? '正在读取协议参数…' : '协议参数尚未读取，请使用“重新读取配置”。'}
                </div>
              ) : (
                <PresetFields
                  editing={Boolean(presetId)}
                  value={value}
                  setValue={setValue}
                  shortIDs={shortIDs}
                  setShortIDs={setShortIDs}
                />
              )}
            </div>
          </fieldset>
          {presetId && !digest ? (
            <p className="text-text-secondary" role="status">
              {loading ? '正在读取协议配置…' : '协议配置尚未读取，请重新读取后编辑。'}
            </p>
          ) : (
            <PresetPreview value={value} referenceable={referenceable} />
          )}
        </div>
        <footer className="fixed bottom-6 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 flex-wrap items-center justify-between gap-4 rounded-xl border-[1px] border-border/80 bg-surface-raised/40 p-4 shadow-2xl backdrop-blur-lg">
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-(length:--text-sm) font-medium"
              title={value.name || 'VLESS'}
            >
              {value.name || 'VLESS'}
            </p>
            <p className="mt-1 text-(length:--text-xs) text-text-secondary">
              {presetId ? '保存前确认引用节点与服务的影响范围' : '保存预设，稍后从节点引用'}
            </p>
          </div>
          <Button
            ref={saveButton}
            type="submit"
            className="min-h-11 shrink-0"
            loading={saving}
            disabled={
              saving || loading || Boolean(presetId && !digest) || session.user.role === 'viewer'
            }
          >
            {saving
              ? presetId
                ? '正在预览…'
                : '正在创建…'
              : presetId
                ? '预览并保存'
                : '创建协议配置'}
          </Button>
        </footer>
      </form>
      {impact && (
        <PresetImpactDialog
          preview={impact}
          saving={saving}
          onClose={() => setImpact(null)}
          onSave={confirmSave}
          returnFocus={() => saveButton.current?.focus()}
        />
      )}
    </>
  );
}
