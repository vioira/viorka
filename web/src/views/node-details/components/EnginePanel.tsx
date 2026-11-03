import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import type { Session } from '@/api/auth';
import {
  type Connection,
  type EngineDraft,
  type EngineRecord,
  type EngineService,
  engineAction,
  engineConnections,
  engineStatus,
  saveDraft,
} from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EngineOperation from './EngineOperation';
import ServiceEditor from './ServiceEditor';
export default function EnginePanel({
  engine,
  session,
  online,
  refresh,
}: {
  engine: EngineRecord;
  session: Session;
  online: boolean;
  refresh: () => Promise<void>;
}) {
  const { toast } = useToastStack();
  const [draft, setDraft] = useState<EngineDraft>(engine.draft);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<EngineService | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const locked = useRef(false);
  const canEdit =
    session.user.role !== 'viewer' &&
    engine.ownership === 'managed' &&
    engine.status !== 'not_installed';
  useEffect(() => {
    if (!dirty) setDraft(engine.draft);
  }, [engine.draft, dirty]);
  const changed = dirty && engine.draft.version !== draft.version;
  function update(services: EngineService[]) {
    setDraft({ ...draft, services });
    setDirty(true);
  }
  async function save() {
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    try {
      const saved = await saveDraft(engine.id, draft, session);
      setDraft(saved);
      setDirty(false);
      toast({ type: 'success', title: '草稿已保存', description: '尚未应用到节点。' });
      await refresh();
    } catch (error) {
      toast({
        id: `draft-${engine.id}`,
        type: 'error',
        title: '草稿未能保存',
        description: error instanceof Error ? error.message : '请刷新后检查版本。',
      });
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  async function reveal() {
    try {
      setConnections(await engineConnections(engine.id, session));
    } catch (error) {
      toast({
        id: `connections-${engine.id}`,
        type: 'error',
        title: '未能读取连接信息',
        description:
          error instanceof Error ? error.message : '需要成功应用配置、登记对外入口并获得凭证权限。',
      });
    }
  }
  const actions = [
    ['engine.apply', '应用配置'],
    ['engine.start', '启动引擎'],
    ['engine.stop', '停止引擎'],
    ['engine.inspect', '核对引擎'],
  ] as const;
  return (
    <section className="space-y-4 border-b-[0.5px] border-border pb-6" aria-label={engine.name}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">
          {engine.name} {engine.version}
        </h3>
        <span>上次确认：{engineStatus(engine.status)}</span>
      </div>
      <p className="text-text-secondary tabular-nums">
        草稿版本 {draft.version} / 期望修订 {engine.desired_revision} / 已确认修订{' '}
        {engine.observed_revision} / 运行意愿：
        {engine.run_intent === 'stopped' ? '保持停止' : '允许运行'}
      </p>
      {changed && (
        <p className="text-text-secondary">
          共享草稿已被其他人修改。当前输入保留，请复制需要的内容后重新读取草稿。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {engine.status === 'not_installed' ? (
          <EngineOperation
            title="安装引擎"
            description="下载固定版本并保持停止，第三方同类实例会阻止安装。"
            disabled={!online || session.user.role !== 'admin'}
            run={(key) => engineAction(engine, 'engine.install', key, session)}
            onDone={refresh}
          />
        ) : (
          actions.map(([operation, title]) => (
            <EngineOperation
              key={operation}
              title={title}
              description={`此操作影响 ${engine.name} 的全部 ${engine.draft.services.length} 项服务。应用配置可能重启共享进程；停止意愿下应用不会启动。核对操作不会宣称未知配置已成功应用。`}
              disabled={!online || !canEdit || dirty}
              run={(key) => engineAction(engine, operation, key, session)}
              onDone={refresh}
            />
          ))
        )}
        {engine.name === 'realm' && (
          <EngineOperation
            title="接受目标风险并应用"
            description="仅当普通 TCP 转发目标暂不可达时使用。确认接受目标暂不可达的风险；配置错误、端口冲突和自循环仍会阻止应用。"
            disabled={!online || !canEdit || dirty}
            run={(key) =>
              engineAction(engine, 'engine.apply', key, session, { allow_unreachable: true })
            }
            onDone={refresh}
          />
        )}
        <EngineOperation
          title="恢复上一配置"
          description="使用上一份成功配置和当前有效凭证创建新修订。可能影响全部服务；已删除服务不能复活。"
          disabled={!online || !canEdit || dirty}
          run={(key) =>
            engineAction(engine, 'engine.apply', key, session, { restore_previous: true })
          }
          onDone={refresh}
        />
        <EngineOperation
          title="卸载引擎"
          description="停止并移除 Viorka 托管的引擎二进制与 systemd 服务。存在服务依赖时会拒绝操作。"
          disabled={
            !online || session.user.role !== 'admin' || engine.draft.services.length > 0 || dirty
          }
          run={(key) => engineAction(engine, 'engine.uninstall', key, session)}
          onDone={refresh}
        />
      </div>
      <p className="text-text-secondary tabular-nums">
        确认时间：{engine.observed_at || '尚未收到执行回报'}
      </p>
      <ul className="space-y-3">
        {draft.services.map((service) => (
          <li key={service.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="wrap-anywhere">
                {service.name}{' '}
                {service.pending_delete ? '（待删除）' : service.enabled ? '（启用）' : '（停用）'}
              </p>
              <p className="text-text-secondary tabular-nums wrap-anywhere">
                {service.listen_host}:{service.listen_port} → {service.target_host}:
                {service.target_port}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="min-h-11"
                disabled={!canEdit || saving}
                onClick={() => setSelected(service)}
              >
                编辑服务
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                disabled={!canEdit || saving}
                onClick={() =>
                  update(
                    draft.services.map((item) =>
                      item.id === service.id
                        ? { ...item, pending_delete: !item.pending_delete }
                        : item,
                    ),
                  )
                }
              >
                {service.pending_delete ? '撤销删除' : '标记删除'}
              </Button>
              {engine.name !== 'realm' && (
                <EngineOperation
                  title="更换凭证"
                  description="为此服务生成新凭证并应用整个已保存草稿。成功后旧凭证失效，需要重新分发连接信息。"
                  disabled={!online || !canEdit || dirty}
                  run={(key) =>
                    engineAction(engine, 'engine.apply', key, session, {
                      rotate_service_id: service.id,
                    })
                  }
                  onDone={() => {
                    setConnections(null);
                    return refresh();
                  }}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      {draft.services.length === 0 && (
        <p className="text-text-secondary">尚无服务。添加并保存草稿后应用配置。</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={!canEdit || saving || draft.services.length >= 32}
          onClick={() =>
            setSelected({
              id: crypto.randomUUID(),
              name: '',
              enabled: true,
              pending_delete: false,
              listen_host: '0.0.0.0',
              listen_port: 443,
              target_host: '',
              target_port: 443,
              server_name: '',
              public_host: '',
              public_port: 0,
            })
          }
        >
          添加服务
        </Button>
        <Button
          className="min-h-11"
          disabled={!canEdit || !dirty || changed || saving}
          loading={saving}
          onClick={() => void save()}
        >
          保存草稿
        </Button>
        <Button
          variant="ghost"
          className="min-h-11"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(engine.draft);
            setDirty(false);
          }}
        >
          重新读取草稿
        </Button>
        {engine.name !== 'realm' && (
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={engine.observed_revision === 0}
            onClick={() => void reveal()}
          >
            查看连接信息
          </Button>
        )}
      </div>
      <ServiceEditor
        service={selected}
        engine={engine.name}
        onClose={() => setSelected(null)}
        onSave={(service) => {
          const index = draft.services.findIndex((item) => item.id === service.id);
          update(
            index < 0
              ? [...draft.services, service]
              : draft.services.map((item) => (item.id === service.id ? service : item)),
          );
          setSelected(null);
        }}
      />
      <Dialog
        open={connections !== null}
        onOpenChange={(open) => {
          if (!open) setConnections(null);
        }}
      >
        <DialogContent
          title="已应用连接信息"
          description="包含客户端凭证，请妥善保管。已有参数不证明当前可用；外部连通尚未验证。"
        >
          {connections?.length === 0 ? (
            <p>已应用服务没有已登记的对外入口。</p>
          ) : (
            connections?.map((item) => (
              <div key={item.service_id} className="space-y-2">
                <Input
                  label={`${item.name} / 修订 ${item.revision}`}
                  value={item.url}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
                {/* A QR symbol keeps its black/white quiet zone as encoded image content. */}
                <div className="w-fit max-w-full bg-white p-4">
                  <QRCode value={item.url} size={192} title={`${item.name} 客户端连接二维码`} />
                </div>
                <p className="text-text-secondary">{engineStatus(engine.status)}</p>
              </div>
            ))
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
