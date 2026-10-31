import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import {
  getNodeSettings,
  type NodeSettings as Settings,
  saveNodeSettings,
} from '@/api/node-settings';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export default function NodeSettings({ id }: { id: string }) {
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const [settings, setSettings] = useState<Settings | null>(null);
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
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const s = await getNodeSettings(id, signal);
        if (!signal?.aborted) apply(s);
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
    [id, apply, toast],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
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
      toast({
        id: `node-settings-${id}`,
        type: 'success',
        title: '节点设置已保存',
        description: '已请求管理连接重连，支持此功能的 Agent 将在握手后采用新设置。',
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
    }
  }
  return (
    <section aria-label="采集与上报设置" className="border-t-[0.5px] border-border pt-6">
      <h2 className="mb-4 font-medium">采集与上报设置</h2>
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
            description="0–10 秒，默认 0，表示随 WSS 上报采集。"
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
          保存后管理连接会短暂重连，代理服务继续运行。离线节点下次连接时应用；旧版 Agent
          需支持采集设置 v2 才能采用这些设置。资产信息独立每 5 分钟刷新。
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
