import { RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  type EngineConfigurationResult,
  type EngineRecord,
  engineAction,
  engineConfiguration,
  engineStatus,
  engineSyncError,
} from '@/api/engines';
import { getTask, type TaskRecord } from '@/api/tasks';
import { Button } from '@/components/arc/button/button';
import { CodeBlock } from '@/components/arc/code-block/code-block';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import InitialSkeleton from '@/components/initial-skeleton';
import { useServerEvent } from '@/hooks/realtime';

export default function EngineConfigurationViewer({
  engine,
  session,
  online,
  renderTrigger,
  returnFocus,
}: {
  engine: EngineRecord;
  session: Session;
  online: boolean;
  renderTrigger: (read: () => void, disabled: boolean) => ReactNode;
  returnFocus: () => void;
}) {
  const { toast } = useToastStack();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<EngineConfigurationResult | null>(null);
  const [snapshot, setSnapshot] = useState<EngineConfigurationResult | null>(null);
  const files = snapshot?.configuration?.files ?? [];
  const [selectedFile, setSelectedFile] = useState('');
  const activeFile = files.some((file) => file.name === selectedFile)
    ? selectedFile
    : (files[0]?.name ?? '');
  const task = useRef('');
  const visible = useRef(false);
  const sequence = useRef(0);
  const completed = useRef('');
  const fetching = useRef('');
  const request = useRef<AbortController | null>(null);
  const key = useRef<string | null>(null);
  const locked = useRef(false);
  const active = result && ['queued', 'dispatched', 'accepted', 'running'].includes(result.state);
  const loading = submitting || !!active;
  const readStatus = submitting ? '正在提交读取…' : active ? '正在读取节点配置…' : '';
  const metadata = snapshot?.configuration
    ? `${engineStatus(snapshot.runtime_status)}，读取于 ${new Date(snapshot.captured_at).toLocaleString()}`
    : '节点活动配置文件';
  const canRead =
    online &&
    session.user.role !== 'viewer' &&
    engine.ownership === 'managed' &&
    engine.last_error !== 'engine_external' &&
    engine.status !== 'not_installed' &&
    engine.version !== '' &&
    engine.sync_state !== 'syncing';

  useEffect(
    () => () => {
      visible.current = false;
      request.current?.abort();
    },
    [],
  );

  async function refresh(id = task.current) {
    if (!id || !visible.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    fetching.current = id;
    setRefreshing(true);
    try {
      const next = await engineConfiguration(engine.id, id, controller.signal);
      if (controller.signal.aborted || task.current !== id) return;
      setResult(next);
      if (next.configuration) {
        completed.current = id;
        setSnapshot(next);
      }
      if (next.state === 'failed' || next.state === 'cancelled') {
        toast({
          id: `engine-config-${id}`,
          type: 'error',
          title: '读取运行配置失败',
          description: engineSyncError(next.error_code),
        });
      }
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: `engine-config-${engine.id}`,
          type: 'error',
          title: '未能读取配置结果',
          description: error instanceof Error ? error.message : '请刷新读取结果。',
        });
    } finally {
      if (controller === request.current) {
        fetching.current = '';
        setRefreshing(false);
      }
    }
  }
  function updateStatus(next: Pick<TaskRecord, 'id' | 'state' | 'error_code'>) {
    if (next.id !== task.current || !visible.current) return;
    if (next.state === 'succeeded') {
      if (completed.current !== next.id && fetching.current !== next.id) void refresh(next.id);
      return;
    }
    setResult({
      task_id: next.id,
      state: next.state,
      error_code: next.error_code,
      captured_at: '',
      runtime_status: '',
      configuration: null,
    });
    if (next.state === 'failed' || next.state === 'cancelled')
      toast({
        id: `engine-config-${next.id}`,
        type: 'error',
        title: '读取运行配置失败',
        description: engineSyncError(next.error_code),
      });
  }
  async function syncStatus(id: string) {
    const version = ++sequence.current;
    try {
      const next = await getTask(id);
      if (sequence.current === version) updateStatus(next);
    } catch (error) {
      if (visible.current && task.current === id && version === sequence.current)
        toast({
          id: `engine-config-${id}`,
          type: 'error',
          title: '未能读取配置任务状态',
          description: error instanceof Error ? error.message : '请刷新读取结果。',
        });
    }
  }
  useServerEvent(
    (event) => {
      if (!open || !task.current) return;
      if (event.type === 'ready') {
        void syncStatus(task.current);
        return;
      }
      if (
        event.type !== 'change' ||
        event.change.kind !== 'tasks' ||
        (event.change.task_id && event.change.task_id !== task.current)
      )
        return;
      if (event.change.task?.id === task.current) {
        sequence.current++;
        updateStatus(event.change.task);
      } else void syncStatus(task.current);
    },
    open ? [{ kind: 'tasks', node_id: engine.node_id }] : [],
  );

  async function read() {
    if (locked.current || !canRead) return;
    locked.current = true;
    setSubmitting(true);
    visible.current = true;
    request.current?.abort();
    task.current = '';
    setOpen(true);
    key.current ??= crypto.randomUUID();
    try {
      const response = await engineAction(engine, 'engine.inspect', key.current, session, {
        include_config: true,
      });
      if (!response.id) throw new Error('节点未返回配置读取任务。');
      task.current = response.id;
      key.current = null;
      if (visible.current) await syncStatus(response.id);
    } catch (error) {
      toast({
        id: `engine-config-${engine.id}`,
        type: 'error',
        title: '未能提交配置读取',
        description: error instanceof Error ? error.message : '请重试读取配置。',
      });
    } finally {
      locked.current = false;
      setSubmitting(false);
    }
  }
  return (
    <>
      {renderTrigger(() => void read(), !canRead || submitting)}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          visible.current = value;
          setOpen(value);
          if (!value) request.current?.abort();
        }}
      >
        <DialogContent
          title={`${engine.name} 运行配置`}
          description={readStatus ? `${metadata}，${readStatus}` : metadata}
          className="sm:min-w-[min(768px,calc(100vw-32px))]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus();
          }}
          footer={
            <>
              <Button
                variant="secondary"
                loading={refreshing}
                disabled={submitting || !task.current}
                onClick={() =>
                  void (completed.current === task.current ? refresh() : syncStatus(task.current))
                }
              >
                <RefreshCw size={16} aria-hidden="true" />
                刷新读取结果
              </Button>
              <Button
                variant="secondary"
                disabled={!canRead || submitting || !!active}
                loading={submitting}
                onClick={() => void read()}
              >
                <RefreshCw size={16} aria-hidden="true" />
                重新读取节点
              </Button>
            </>
          }
        >
          <div className="min-w-0" aria-busy={loading}>
            <span className="sr-only" role="status">
              {readStatus}
            </span>
            {!snapshot?.configuration && (
              <div className="min-h-96 py-4">
                {loading ? (
                  <div className="space-y-8">
                    <InitialSkeleton label="正在加载配置文件" lines={1} />
                    <InitialSkeleton label="正在加载配置内容" lines={6} />
                  </div>
                ) : (
                  <p className="text-(length:--text-sm) text-text-secondary">配置尚未读取</p>
                )}
              </div>
            )}
            {snapshot?.configuration && (
              <Tabs value={activeFile} onValueChange={setSelectedFile} className="min-w-0">
                <TabsList aria-label="运行配置文件">
                  {files.map((file) => (
                    <TabsTrigger key={file.name} value={file.name} title={file.name}>
                      {file.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {files.map((file) => (
                  <TabsContent
                    key={file.name}
                    value={file.name}
                    forceMount
                    hidden={activeFile !== file.name}
                  >
                    <CodeBlock
                      filename={file.name}
                      language={file.name.endsWith('.toml') ? 'toml' : 'json'}
                      code={file.content}
                      maxLines={24}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
