import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@/api/auth';
import type { NodeRecord } from '@/api/nodes';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import NodeDangerZone from './NodeDangerZone';

const adminSession: Session = {
  user: { id: 'admin-1', username: 'admin', role: 'admin' },
  csrf_token: 'test-token',
  expires_at: '2026-11-04T00:00:00Z',
};

const viewerSession: Session = {
  user: { id: 'viewer-1', username: 'viewer', role: 'viewer' },
  csrf_token: 'test-token',
  expires_at: '2026-11-04T00:00:00Z',
};

let currentSession = adminSession;

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useOutletContext: () => currentSession,
    useNavigate: () => vi.fn(),
  };
});

const mockNode: NodeRecord = {
  id: 'node-hk-01',
  name: 'HK-BGP-01',
  kind: 'vps',
  state: 'offline',
  last_seen_at: '2026-11-01T00:00:00Z',
  os: 'Debian 12',
  arch: 'x86_64',
  agent_version: '0.2.1',
};

describe('NodeDangerZone', () => {
  it('renders danger actions for admin session', () => {
    currentSession = adminSession;
    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <MemoryRouter>
          <NodeDangerZone node={mockNode} session={adminSession} />
        </MemoryRouter>
      </ToastStackProvider>,
    );

    expect(html).toContain('节点凭据与生命周期');
    expect(html).toContain('重新签发注册令牌');
    expect(html).toContain('吊销 Agent 凭据');
    expect(html).toContain('从控制面移除节点');
    expect(html).toContain('重新签发');
    expect(html).toContain('吊销凭据');
    expect(html).toContain('移除节点');
  });

  it('renders nothing for non-admin session', () => {
    currentSession = viewerSession;
    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <MemoryRouter>
          <NodeDangerZone node={mockNode} session={viewerSession} />
        </MemoryRouter>
      </ToastStackProvider>,
    );

    expect(html).toBe('');
  });
});
