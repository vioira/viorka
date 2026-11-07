import { useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { type EngineRecord, engineAction, engineStatus } from '@/api/engines';
import { nodeTime } from '@/api/nodes';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import EngineOperation from './EngineOperation';

export default function EngineRuntime({
  engine,
  session,
  online,
  dirty,
  canEdit,
  refresh,
}: {
  engine: EngineRecord;
  session: Session;
  online: boolean;
  dirty: boolean;
  canEdit: boolean;
  refresh: () => Promise<void>;
}) {
  const menu = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const disabled = !online || !canEdit || dirty;
  const actions = [
    {
      title: '核对引擎',
      operation: 'engine.inspect',
      description: '核对节点实际运行状态，不会将未知配置标记为应用成功。',
      disabled: !online || !canEdit,
    },
    {
      title: '恢复上一配置',
      operation: 'engine.apply',
      description:
        '恢复上一份成功的服务设置并沿用当前有效凭证；协议引用仍继承当前共享参数。可能影响全部服务，已删除服务不能复活。',
      options: { restore_previous: true },
      disabled,
    },
    ...(engine.name === 'realm'
      ? [
          {
            title: '接受目标风险并应用',
            operation: 'engine.apply',
            description:
              '仅接受普通 TCP 转发目标暂不可达的风险；配置错误、端口冲突和自循环仍会阻止应用。',
            options: { allow_unreachable: true },
            disabled,
          },
        ]
      : []),
    {
      title: '卸载引擎',
      operation: 'engine.uninstall',
      description:
        '停止并移除 Viorka 托管的二进制与 systemd 服务。必须先删除全部关联服务并成功应用。',
      disabled: disabled || session.user.role !== 'admin' || engine.draft.services.length > 0,
    },
  ];
  const action = actions.find((item) => item.title === selected);
  return (
    <section
      aria-label={`${engine.name} 运行时`}
      className="space-y-4 rounded-(--radius-panel) border-[1px] border-border bg-surface p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-(length:--text-xl) font-medium">{engine.name}</h2>
            <span className="text-text-secondary tabular-nums">
              {engine.version || '版本未确认'}
            </span>
            <span
              className={
                engine.status === 'running'
                  ? 'text-success'
                  : engine.status === 'degraded'
                    ? 'text-danger'
                    : 'text-text-secondary'
              }
            >
              {engineStatus(engine.status)}
            </span>
          </div>
          <p className="text-text-secondary">
            {engine.ownership === 'managed' ? 'Viorka 托管' : '第三方实例，只读'} / 运行意愿：
            {engine.run_intent === 'stopped' ? '保持停止' : '允许运行'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {engine.status === 'not_installed' ? (
            <EngineOperation
              title="安装引擎"
              description="下载固定版本并校验摘要，第三方同类实例会阻止安装。安装完成不代表已启动。"
              disabled={!online || session.user.role !== 'admin' || engine.ownership !== 'managed'}
              run={(key) => engineAction(engine, 'engine.install', key, session)}
              onDone={refresh}
            />
          ) : (
            <>
              <EngineOperation
                title={engine.status === 'running' ? '停止引擎' : '启动引擎'}
                description={`此操作影响 ${engine.draft.services.length} 项服务。停止会中断全部连接，并在后续应用配置及节点重启后保持停止；启动才会恢复运行意愿。`}
                disabled={disabled}
                run={(key) =>
                  engineAction(
                    engine,
                    engine.status === 'running' ? 'engine.stop' : 'engine.start',
                    key,
                    session,
                  )
                }
                onDone={refresh}
              />
              <div ref={menu}>
                <DropdownMenu
                  label="更多操作"
                  items={actions.map((item) => ({
                    label: item.title,
                    disabled: item.disabled,
                    destructive: item.operation === 'engine.uninstall',
                    onSelect: () => setSelected(item.title),
                  }))}
                />
              </div>
            </>
          )}
        </div>
      </div>
      <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
        上次确认：{nodeTime(engine.observed_at)}。外部连通尚未验证。
      </p>
      {action && (
        <EngineOperation
          key={action.title}
          title={action.title}
          description={action.description}
          disabled={action.disabled}
          returnFocus={() => menu.current?.querySelector<HTMLElement>('button')?.focus()}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          run={(key) => engineAction(engine, action.operation, key, session, action.options)}
          onDone={refresh}
        />
      )}
    </section>
  );
}
