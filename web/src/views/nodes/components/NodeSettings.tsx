import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import {
  getNodeSettings,
  getNodeSettingsStatus,
  type NodeSettingsStatus,
  type NodeSettings as Settings,
  saveNodeSettings,
} from '@/api/node-settings';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useServerEvent } from '@/hooks/realtime';

export default function NodeSettings({ id }: { id: string }) {
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<NodeSettingsStatus | null>(null);
  const statusRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [values, setValues] = useState({
    collection_seconds: '',
    report_seconds: '',
    wss_report_seconds: '',
  });
  const admin = session.user.role === 'admin';
  const apply = useCallback((s: Settings) => {
    setSettings(s);
    setValues({
      collection_seconds: String(s.collection_seconds),
      report_seconds: String(s.report_seconds),
      wss_report_seconds: String(s.wss_report_seconds),
    });
  }, []);
  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++statusRequest.current;
      try {
        const next = await getNodeSettingsStatus(id, signal);
        if (!signal?.aborted && request === statusRequest.current) setStatus(next);
      } catch (e) {
        if (!signal?.aborted && request === statusRequest.current) {
          setStatus(null);
          toast({
            id: `node-settings-status-${id}`,
            type: 'error',
            title: '读取同步状态失败',
            description: e instanceof Error ? e.message : '请重新读取。',
          });
        }
      }
    },
    [id, toast],
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const s = await getNodeSettings(id, signal);
        if (!signal?.aborted) {
          apply(s);
          await loadStatus(signal);
        }
      } catch (e) {
        if (!signal?.aborted)
          toast({
            id: `node-settings-${id}`,
            type: 'error',
            title: '读取节点设置失败',
            description: e instanceof Error ? e.message : '请重新读取。',
          });
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [id, apply, toast, loadStatus],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useServerEvent((event) => {
    if (
      event.type === 'change' &&
      event.change.kind === 'node_settings_result' &&
      event.change.node_id === id
    ) {
      void loadStatus();
      return;
    }
    if (busy.current || loading || !settings) return;
    if (
      event.type !== 'ready' &&
      !(
        event.type === 'change' &&
        event.change.kind === 'node_settings' &&
        event.change.node_id === id
      )
    )
      return;
    const dirty =
      values.collection_seconds !== String(settings.collection_seconds) ||
      values.report_seconds !== String(settings.report_seconds) ||
      values.wss_report_seconds !== String(settings.wss_report_seconds);
    if (dirty) {
      void loadStatus();
      toast({
        id: `node-settings-${id}`,
        type: 'info',
        title: '请核对最新采集设置',
        description: '当前输入已保留。重新读取会载入服务端设置。',
        action: { label: '重新读取', onClick: () => void load() },
      });
    } else void load();
  });
  async function save() {
    if (!settings || !admin || busy.current) return;
    const next = {
      ...settings,
      collection_seconds: Number(values.collection_seconds),
      report_seconds: Number(values.report_seconds),
      wss_report_seconds: Number(values.wss_report_seconds),
    };
    busy.current = true;
    setSaving(true);
    try {
      apply(await saveNodeSettings(session, id, next));
      ++statusRequest.current;
      setStatus({ state: 'pending' });
      toast({
        id: `node-settings-${id}`,
        type: 'success',
        title: '节点设置已保存',
        description: '已提交同步，请查看节点确认状态。',
      });
    } catch (e) {
      toast({
        id: `node-settings-${id}`,
        type: 'error',
        title: '保存节点设置失败',
        description: e instanceof Error ? e.message : '请重试。',
      });
    } finally {
      busy.current = false;
      setSaving(false);
      void loadStatus();
    }
  }
  return (
    <section aria-label="采集与上报设置" className="border-t-[0.5px] border-border pt-6">
      <h2 className="mb-4 font-medium">采集与上报设置</h2>
      <p
        role="status"
        className="mb-4 min-h-5 text-(length:--text-xs) text-text-secondary tabular-nums"
      >
        同步状态：
        {status === null
          ? '尚未读取'
          : status.state === 'pending'
            ? '待同步或尚未收到节点确认'
            : status.state === 'applied'
              ? `已生效（版本 ${status.result?.revision}）`
              : `应用失败（版本 ${status.result?.revision}）`}
        {status?.state === 'failed' &&
          (status.result?.error_code === 'persist_failed'
            ? '，请检查节点状态目录权限和磁盘空间。'
            : '，请核对节点配置版本与 Agent 日志。')}
      </p>
      <form
        className="space-y-4"
        aria-busy={loading || saving}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset
          disabled={!admin || !settings || loading || saving}
          className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <Input
            label="采集间隔（秒）"
            type="number"
            required
            min={0}
            max={10}
            step={1}
            value={values.collection_seconds}
            placeholder="尚未读取"
            onChange={(e) => setValues({ ...values, collection_seconds: e.target.value })}
            description="0–10 秒，默认 0，使用 WSS 上报间隔作为采集周期。"
          />
          <Input
            label="上报间隔（秒）"
            type="number"
            required
            min={30}
            max={180}
            step={1}
            value={values.report_seconds}
            placeholder="尚未读取"
            onChange={(e) => setValues({ ...values, report_seconds: e.target.value })}
            description="历史指标批量入库，30–180 秒，默认 60 秒。"
          />
          <Input
            label="连接模式"
            value="WSS"
            readOnly
            description="当前仅支持 WSS，HTTP POST 暂不支持。"
          />
          <Input
            label="WSS 上报间隔（秒）"
            type="number"
            required
            min={1}
            max={5}
            step={1}
            value={values.wss_report_seconds}
            placeholder="尚未读取"
            onChange={(e) => setValues({ ...values, wss_report_seconds: e.target.value })}
            description="实时指标发送，1–5 秒，默认 2 秒。"
          />
        </fieldset>
        <p className="text-(length:--text-xs) text-text-secondary">
          新版 Agent 在线应用并确认设置，离线节点下次连接时同步。旧版 Agent
          通过重连获取设置，可能无法回报生效确认。代理服务继续运行，资产信息每 5 分钟刷新。
          {!admin && '仅管理员可修改。'}
        </p>
        <div className="flex flex-wrap gap-2">
          {admin && (
            <Button type="submit" loading={saving} disabled={!settings || loading || saving}>
              保存节点设置
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={loading || saving}
            onClick={() => load()}
          >
            重新读取
          </Button>
        </div>
      </form>
    </section>
  );
}
