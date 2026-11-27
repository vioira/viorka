import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import type { Session } from '@/api/auth';
import {
  createProtocolPreset,
  getProtocolPreset,
  type PresetImpactPreview,
  previewProtocolPreset,
  updateProtocolPreset,
} from '@/api/protocol-presets';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import InitialSkeleton from '@/components/initial-skeleton';
import ProxyWorkbench from '@/components/proxy/ProxyWorkbench';
import PresetFields from './components/PresetFields';
import PresetImpactDialog from './components/PresetImpactDialog';
import PresetPreview from './components/PresetPreview';
import {
  type PresetDraft,
  presetConfig,
  presetDraft,
  type ShortIDField,
  validatePresetDraft,
} from './preset-validation';

function defaultPresetConfig(): PresetDraft {
  return {
    name: '',
    protocol: 'vless',
    port: '443',
    transport: 'tcp',
    security: 'reality',
    site: 'external',
    target: '',
    short_ids: [],
    fingerprint: 'chrome',
    certificate: '',
    server_name: '',
    cdn_host: '',
    path: '',
  };
}

function serializePresetState(config: PresetDraft, shortIDs: ShortIDField[]) {
  return JSON.stringify({
    config,
    short_ids: shortIDs.map((field) => field.value),
  });
}

export default function NewProtocolPresetPage() {
  const { presetId } = useParams();
  const formId = useId();
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const { toast } = useToastStack();
  const canManage = session.user.role !== 'viewer';

  const [digest, setDigest] = useState('');
  const [loading, setLoading] = useState(Boolean(presetId));
  const [impact, setImpact] = useState<PresetImpactPreview | null>(null);
  const [formValue, setValue] = useState<PresetDraft>(defaultPresetConfig);
  const [shortIDs, setShortIDs] = useState<ShortIDField[]>([]);
  const [baseline, setBaseline] = useState(() => serializePresetState(defaultPresetConfig(), []));
  const [saving, setSaving] = useState(false);

  const [attempted, setAttempted] = useState(false);
  const [savedHasShortIDs, setSavedHasShortIDs] = useState(false);

  const locked = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);

  const value = useMemo(() => presetConfig(formValue, shortIDs), [formValue, shortIDs]);
  const issue = validatePresetDraft(formValue, shortIDs);

  const load = useCallback(async () => {
    if (!presetId) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const preset = await getProtocolPreset(presetId, abort.signal);
      if (abort.signal.aborted) return;
      const loadedIDs = preset.config.short_ids.map((item, index) => ({ id: index, value: item }));
      const draft = presetDraft(preset.config);
      setValue(draft);
      setAttempted(false);
      setSavedHasShortIDs(loadedIDs.length > 0);
      setDigest(preset.digest);
      setImpact(null);
      setShortIDs(loadedIDs);
      setBaseline(serializePresetState(draft, loadedIDs));
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

  const referenceable =
    !issue &&
    value.transport === 'tcp' &&
    value.security === 'reality' &&
    value.site === 'external' &&
    value.fingerprint === 'chrome' &&
    (!presetId || value.short_ids.length > 0 || savedHasShortIDs);
  const statusLabel = issue ? '参数待完善' : referenceable ? '可节点引用' : '仅保存预设';

  const dirty = serializePresetState(formValue, shortIDs) !== baseline;

  function applyStarter(kind: 'tcp-reality' | 'xhttp-reality' | 'ws-tls') {
    if (kind === 'tcp-reality') {
      setValue((prev) => ({
        ...prev,
        security: 'reality',
        transport: 'tcp',
        site: 'external',
        fingerprint: 'chrome',
        certificate: '',
        cdn_host: '',
        path: '',
      }));
    } else if (kind === 'xhttp-reality') {
      setValue((prev) => ({
        ...prev,
        security: 'reality',
        transport: 'xhttp',
        site: 'external',
        fingerprint: 'chrome',
        certificate: '',
        cdn_host: '',
        path: prev.path || '/',
      }));
    } else {
      setShortIDs([]);
      setValue((prev) => ({
        ...prev,
        security: 'tls',
        transport: 'ws',
        site: '',
        target: '',
        short_ids: [],
        certificate: 'self_signed',
        path: prev.path || '/',
      }));
    }
  }

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
      setBaseline(serializePresetState(formValue, shortIDs));
      toast({
        id: 'preset-save',
        type: 'success',
        title: '协议配置已保存',
        description: '有变化的引擎将自动同步；离线节点上线后同步。请在节点页面查看实际结果。',
      });
      setImpact(null);
      await navigate('/proxy/protocol-presets');
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

  async function save(form: HTMLFormElement) {
    if (locked.current || formDisabled) return;
    if (issue) {
      setAttempted(true);
      const field = form.elements.namedItem(issue.field);
      if (field instanceof HTMLElement) field.focus();
      toast({
        id: 'preset-validation',
        type: 'error',
        title: '请检查协议参数',
        description: issue.message,
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
            config: value,
            base_digest: digest,
            confirmation: '',
          },
          session,
        );
        setImpact(preview);
        return;
      }
      await createProtocolPreset(value, session);
      setBaseline(serializePresetState(formValue, shortIDs));
      toast({
        type: 'success',
        title: '协议配置已创建',
        description: '已保存预设，尚未部署到节点。',
      });
      await navigate('/proxy/protocol-presets');
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

  const formDisabled = saving || loading || Boolean(presetId && !digest) || !canManage;

  return (
    <ProxyWorkbench
      parentLabel="协议配置"
      parentPath="/proxy/protocol-presets"
      breadcrumbLabel={presetId ? '编辑协议配置' : '新建协议配置'}
      title={presetId ? `编辑协议配置${value.name ? `：${value.name}` : ''}` : '新建协议配置'}
      subtitle={
        presetId
          ? '保存前预览并确认受影响节点与服务，已发布服务将持续继承共享参数。'
          : '保存为实例共享预设，随后在节点引擎草稿中引用。'
      }
      meta={
        <Badge size="sm" tone={referenceable ? 'success' : 'neutral'} dot={referenceable}>
          {statusLabel}
        </Badge>
      }
      form={formId}
      saveLabel={presetId ? '预览影响并保存' : '创建协议配置'}
      saveButtonRef={saveButton}
      busy={saving}
      disabled={formDisabled}
      dirty={dirty && !saving}
      backLabel="返回协议配置"
      onClose={() => void navigate('/proxy/protocol-presets')}
      actions={
        presetId ? (
          <Button
            type="button"
            variant="secondary"
            loading={loading}
            disabled={saving || loading}
            onClick={() => void load()}
          >
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            重新读取
          </Button>
        ) : undefined
      }
    >
      {!presetId && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="快速填充组合">
          <span className="text-(length:--text-xs) text-text-secondary">快速填充组合</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={formDisabled}
            onClick={() => applyStarter('tcp-reality')}
          >
            TCP Vision + REALITY（当前可引用）
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={formDisabled}
            onClick={() => applyStarter('xhttp-reality')}
          >
            XHTTP + REALITY（存档）
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={formDisabled}
            onClick={() => applyStarter('ws-tls')}
          >
            WebSocket + TLS + CDN（存档）
          </Button>
        </div>
      )}

      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget);
        }}
        className="min-w-0"
        aria-busy={saving || loading}
      >
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <fieldset disabled={formDisabled} className="min-w-0">
            <legend className="sr-only">VLESS 协议配置</legend>
            {presetId && !digest ? (
              <div className="v-card min-h-72" role="status">
                {loading ? (
                  <InitialSkeleton label="正在读取协议参数" lines={5} />
                ) : (
                  <p className="text-(length:--text-sm) text-text-secondary">
                    协议参数尚未读取，请使用上方「重新读取」。
                  </p>
                )}
              </div>
            ) : (
              <PresetFields
                editing={Boolean(presetId)}
                value={formValue}
                invalidField={attempted ? issue?.field : undefined}
                setValue={setValue}
                shortIDs={shortIDs}
                setShortIDs={setShortIDs}
              />
            )}
          </fieldset>

          {presetId && !digest ? (
            <div className="v-card" role="status">
              <p className="text-(length:--text-xs) text-text-secondary">
                {loading ? '正在读取协议配置…' : '协议配置尚未读取，请重新读取后编辑。'}
              </p>
            </div>
          ) : (
            <PresetPreview
              value={value}
              referenceable={referenceable}
              invalid={Boolean(issue)}
              firstShortID={value.short_ids[0] ?? ''}
            />
          )}
        </div>
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
    </ProxyWorkbench>
  );
}
