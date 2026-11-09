import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Session } from '@/api/auth';
import type { EngineRecord } from '@/api/engines';
import { canOperateEngine } from '@/api/engines';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import EnginePipeline from './EnginePipeline';
import EngineRuntime from './EngineRuntime';

const session: Session = {
  user: { id: 'u1', username: 'admin', role: 'admin' },
  csrf_token: 'test',
  expires_at: '',
};

const baseEngine: EngineRecord = {
  sync_state: 'synced',
  id: 'eng-1',
  node_id: 'node-1',
  name: 'sing-box',
  version: '1.10.7',
  ownership: 'managed',
  status: 'running',
  observed_at: '2026-03-30T10:00:00Z',
  run_intent: 'running',
  desired_revision: 5,
  observed_revision: 5,
  external_connectivity: 'reachable',
  draft: {
    version: 8,
    services: [],
    updated_by: 'admin',
    updated_at: '',
  },
};

describe('EnginePipeline', () => {
  it('renders clean synced pipeline state', () => {
    const syncedEngine: EngineRecord = {
      ...baseEngine,
      desired_revision: 5,
      observed_revision: 5,
      draft: { ...baseEngine.draft, version: 5 },
    };

    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <EnginePipeline
          engine={syncedEngine}
          draftVersion={5}
          session={session}
          online={true}
          canEdit={true}
          saving={false}
          onReview={() => {}}
          onDeploy={() => {}}
          onRefresh={async () => {}}
        />
      </ToastStackProvider>,
    );

    expect(html).toContain('草稿 v5');
    expect(html).toContain('最新操作 r5');
    expect(html).toContain('节点已确认 r5');
    expect(html).toContain('已发布目标已确认');
  });

  it('does not compare draft versions with operation revisions', () => {
    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <EnginePipeline
          engine={baseEngine}
          draftVersion={9}
          session={session}
          online={true}
          canEdit={true}
          saving={false}
          onReview={() => {}}
          onDeploy={() => {}}
          onRefresh={async () => {}}
        />
      </ToastStackProvider>,
    );

    expect(html).toContain('草稿 v9');
    expect(html).toContain('已发布目标已确认');
    expect(html).not.toContain('待应用');
    expect(html).toContain('发布已保存草稿');
  });

  it('renders error notice and retry button when sync state fails', () => {
    const failedEngine: EngineRecord = {
      ...baseEngine,
      sync_state: 'failed',
      sync_error: 'engine_port_conflict',
    };

    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <EnginePipeline
          engine={failedEngine}
          draftVersion={8}
          session={session}
          online={true}
          canEdit={true}
          saving={false}
          onReview={() => {}}
          onDeploy={() => {}}
          onRefresh={async () => {}}
        />
      </ToastStackProvider>,
    );

    expect(html).toContain('端口冲突');
    expect(html).toContain('重试同步');
  });
});

describe('引擎状态与操作边界', () => {
  it.each(['sing-box', 'xray', 'realm'])('%s 归属冲突时只能核对，不误报托管和同步成功', (name) => {
    const engine = {
      ...baseEngine,
      name,
      status: 'unknown',
      version: '',
      observed_at: '',
      observed_revision: 0,
      desired_revision: 2,
      last_error: 'engine_external',
      sync_state: 'unpublished',
    };
    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <EngineRuntime
          engine={engine}
          session={session}
          online
          dirty={false}
          canEdit
          refresh={async () => {}}
        />
        <EnginePipeline
          engine={engine}
          draftVersion={0}
          session={session}
          online
          canEdit
          saving={false}
          onReview={() => {}}
          onDeploy={() => {}}
          onRefresh={async () => {}}
        />
      </ToastStackProvider>,
    );
    expect(html).toContain('归属冲突');
    expect(html).toContain('托管归属待确认');
    expect(html).toContain('核对引擎');
    expect(html).toContain('节点尚未确认');
    expect(html).toContain('尚未发布配置');
    expect(html).not.toContain('启动引擎');
    expect(html).not.toContain('节点已确认 r0');
    expect(html).not.toContain('已同步');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*?发布已保存草稿/s);
  });
  it.each(['unknown', 'degraded', 'not_installed'])('阻止 %s 状态执行变更', (status) => {
    expect(canOperateEngine({ ...baseEngine, status })).toBe(false);
  });
  it('未保存草稿禁止发布，已提交目标显示等待节点应用', () => {
    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <EnginePipeline
          engine={{ ...baseEngine, sync_state: 'pending' }}
          draftVersion={1}
          session={session}
          online
          canEdit
          saving={false}
          dirty
          onReview={() => {}}
          onDeploy={() => {}}
          onRefresh={async () => {}}
        />
      </ToastStackProvider>,
    );
    expect(html).toContain('未保存');
    expect(html).toContain('目标配置待节点应用');
    expect(html).not.toContain('已保存草稿待发布');
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBe(2);
    expect(buttons.every((button) => button.includes('disabled'))).toBe(true);
  });
  it('离线时不显示当前正在运行', () => {
    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <EngineRuntime
          engine={baseEngine}
          session={session}
          online={false}
          dirty={false}
          canEdit
          refresh={async () => {}}
        />
      </ToastStackProvider>,
    );
    expect(html).toContain('节点离线，状态待确认');
    expect(html).not.toContain('运行中');
  });
});
