import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Session } from '@/api/auth';
import type { EngineRecord } from '@/api/engines';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import EnginePipeline from './EnginePipeline';

const session: Session = {
  user: { id: 'u1', username: 'admin', role: 'admin' },
  csrf_token: 'test',
  expires_at: '',
};

const baseEngine: EngineRecord = {
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
    expect(html).toContain('目标 r5');
    expect(html).toContain('节点已确认 r5');
    expect(html).toContain('重新应用配置');
  });

  it('renders pending deployment state when draft is ahead', () => {
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
    expect(html).toContain('已保存草稿待发布到节点');
    expect(html).toContain('发布配置到节点');
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
