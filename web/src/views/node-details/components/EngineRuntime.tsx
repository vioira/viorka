import { useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  canOperateEngine,
  type EngineRecord,
  engineAction,
  engineRuntimeStatus,
} from '@/api/engines';
import { nodeTime } from '@/api/nodes';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { RadioGroup } from '@/components/arc/radio-group/radio-group';
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
  const [serviceChoice, setServiceChoice] = useState('keep');
  const disabled = !online || !canEdit || dirty || !canOperateEngine(engine);
  const inspectDisabled =
    !online ||
    session.user.role === 'viewer' ||
    engine.ownership !== 'managed' ||
    engine.sync_state === 'syncing';
  const needsInspection =
    engine.last_error === 'engine_external' ||
    (!canOperateEngine(engine) && engine.status !== 'not_installed');
  const actions = [
    {
      title: '核对引擎',
      operation: 'engine.inspect',
      description: '核对节点实际运行状态，不会将未知配置标记为应用成功。',
      disabled: inspectDisabled,
    },
    {
      title: '恢复上一配置',
      operation: 'engine.apply',
      description:
        '恢复上一份成功的服务设置并沿用当前有效凭证；协议引用仍继承当前共享参数。可能影响全部服务，已删除服务不能复活。',
      options: { restore_previous: true },
      disabled,
    },
    {
      title: '卸载引擎',
      operation: 'engine.uninstall',
      description: '停止并移除 Viorka 托管的引擎及系统服务，全部关联服务将中断。',
      disabled: disabled || session.user.role !== 'admin',
    },
  ];
  const action = actions.find((item) => item.title === selected);

  return (
    <section aria-label={`${engine.name} 运行时`} className="p-3.5 space-y-2 bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Identity & Badges */}
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h2 className="text-(length:--text-base) font-medium tracking-tight">{engine.name}</h2>

          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-(length:--text-xs) font-medium border-[1px] ${
              engine.last_error === 'engine_external'
                ? 'bg-surface-raised text-warning border-warning'
                : online && engine.status === 'running'
                  ? 'bg-surface-raised text-success border-success/30'
                  : engine.status === 'degraded'
                    ? 'bg-surface-raised text-danger border-danger/30'
                    : 'bg-surface-raised text-text-muted border-border'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                engine.last_error === 'engine_external'
                  ? 'bg-warning'
                  : online && engine.status === 'running'
                    ? 'bg-success'
                    : engine.status === 'degraded'
                      ? 'bg-danger'
                      : 'bg-text-muted'
              }`}
            />
            {engineRuntimeStatus(engine, online)}
          </span>

          <span className="px-1.5 py-0.5 rounded bg-surface-raised font-mono text-(length:--text-xs) text-text-secondary border-[1px] border-border tabular-nums">
            {engine.version || '版本未确认'}
          </span>

          <span className="text-(length:--text-xs) text-text-secondary flex items-center gap-1.5 flex-wrap">
            <span>
              {engine.ownership !== 'managed'
                ? '第三方实例，只读'
                : engine.last_error === 'engine_external' || !engine.observed_at
                  ? '托管归属待确认'
                  : 'Viorka 托管'}
            </span>
            <span className="text-text-muted">/</span>
            <span>运行意愿：{engine.run_intent === 'stopped' ? '保持停止' : '允许运行'}</span>
            <span className="text-text-muted">/</span>
            <span className="tabular-nums text-text-muted">
              上次确认：{nodeTime(engine.observed_at)}
            </span>
          </span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {needsInspection ? (
            <EngineOperation
              title="核对引擎"
              description="核对节点上的引擎归属与运行状态。"
              disabled={inspectDisabled}
              run={(key) => engineAction(engine, 'engine.inspect', key, session)}
              onDone={refresh}
            />
          ) : engine.status === 'not_installed' ? (
            <EngineOperation
              title="安装引擎"
              description="下载固定版本并校验摘要，第三方同类实例会阻止安装。安装完成不代表已启动。"
              disabled={
                !online ||
                session.user.role !== 'admin' ||
                engine.ownership !== 'managed' ||
                engine.sync_state === 'syncing' ||
                engine.last_error === 'engine_external'
              }
              run={(key) => engineAction(engine, 'engine.install', key, session)}
              onDone={refresh}
            />
          ) : (
            <>
              <EngineOperation
                title={engine.status === 'running' ? '停止引擎' : '启动引擎'}
                variant={engine.status === 'running' ? 'secondary' : 'primary'}
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
                    onSelect: () => {
                      setServiceChoice('keep');
                      setSelected(item.title);
                    },
                  }))}
                />
              </div>
            </>
          )}
        </div>
      </div>

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
          run={(key) =>
            engineAction(
              engine,
              action.operation,
              key,
              session,
              action.operation === 'engine.uninstall'
                ? { delete_services: serviceChoice === 'delete' }
                : action.options,
            )
          }
          onDone={refresh}
        >
          {action.operation === 'engine.uninstall' && engine.draft.services.length > 0
            ? (locked) => (
                <fieldset disabled={locked} className="min-w-0">
                  <RadioGroup
                    label={`关联服务（${engine.draft.services.length} 项）`}
                    value={serviceChoice}
                    onValueChange={setServiceChoice}
                    options={[
                      {
                        value: 'keep',
                        label: '保留服务',
                        description: '保留配置和凭证，重新安装后应用配置即可恢复。',
                      },
                      {
                        value: 'delete',
                        label: '删除全部关联服务',
                        description: '卸载成功后删除服务配置和凭证，无法撤销。',
                      },
                    ]}
                  />
                </fieldset>
              )
            : undefined}
        </EngineOperation>
      )}
    </section>
  );
}
