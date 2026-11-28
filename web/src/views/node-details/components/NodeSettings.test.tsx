import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@/api/auth';
import type { NodeRecord } from '@/api/nodes';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import type { useCategoryCatalog } from '@/components/node-classification';
import NodeSettings, { type SettingsSectionId } from './NodeSettings';

const adminSession: Session = {
  user: { id: 'admin-1', username: 'admin', role: 'admin' },
  csrf_token: 'test-token',
  expires_at: '2026-12-01T00:00:00Z',
};

const viewerSession: Session = {
  user: { id: 'viewer-1', username: 'viewer', role: 'viewer' },
  csrf_token: 'test-token',
  expires_at: '2026-12-01T00:00:00Z',
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

vi.mock('@/api/telemetry-settings', () => ({
  getTelemetrySettings: vi.fn().mockResolvedValue({
    desired: {
      revision: 2,
      log_level: 'warn',
      connection_mode: 'auto_http_wss',
      collection_seconds: 30,
      http_report_seconds: 60,
      wss_report_seconds: 2,
      tcp_probe: { use_global: true, targets: [], names: [] },
      traffic: {
        interfaces: 'eth0',
        reset_day: 1,
        reset_hour: 0,
        reset_minute: 0,
        timezone: 'UTC',
        billing_mode: 'both',
        quota_bytes: '0',
      },
    },
    status: { state: 'applied', result: { revision: 2, applied_revision: 2, state: 'applied' } },
  }),
  telemetrySettingsState: vi.fn().mockReturnValue('applied'),
}));

vi.mock('@/hooks/realtime', () => ({
  useServerEvent: vi.fn(),
  useRealtimeConnection: () => ({ initialized: true, enabled: false, generation: 0 }),
}));

const mockNode: NodeRecord = {
  id: 'node-hk-01',
  name: 'hk-cmi-edge-01',
  domain: 'hk.example.com',
  kind: 'vps',
  state: 'online',
  last_seen_at: '2026-11-27T00:00:00Z',
  os: 'Debian 12',
  arch: 'x86_64',
  agent_version: '0.14.2',
  billing: {
    revision: 1,
    price: '12.50',
    currency: 'USD',
    period_months: 1,
    expires_at: '2026-12-31T15:59:59Z',
  },
  categories: [
    { id: 'grp-1', kind: 'group', name: '亚太线路', shared: true },
    { id: 'tag-1', kind: 'tag', name: 'CN2 GIA', shared: false },
  ],
};

const mockCatalogState: ReturnType<typeof useCategoryCatalog> = {
  catalog: null,
  loading: false,
  refresh: vi.fn().mockResolvedValue(undefined),
  setCatalog: vi.fn(),
};

function renderSection(session: Session, section: SettingsSectionId) {
  currentSession = session;
  return renderToStaticMarkup(
    <ToastStackProvider>
      <MemoryRouter>
        <NodeSettings
          id={mockNode.id}
          active={true}
          node={mockNode}
          session={session}
          negotiated={true}
          applied={{
            revision: 2,
            log_level: 'warn',
            connection_mode: 'auto_http_wss',
            collection_seconds: 30,
            http_report_seconds: 60,
            wss_report_seconds: 2,
          }}
          catalogState={mockCatalogState}
          onChanged={async () => {}}
          initialSection={section}
        />
      </MemoryRouter>
    </ToastStackProvider>,
  );
}

describe('NodeSettings view', () => {
  it('renders general identity, billing, and all 5 nav sections for admin', () => {
    const html = renderSection(adminSession, 'general');

    expect(html).toContain('常规与资产');
    expect(html).toContain('流量与配额');
    expect(html).toContain('监控与探测');
    expect(html).toContain('Agent 与运行');
    expect(html).toContain('凭据与安全');

    expect(html).toContain('节点标识与分类');
    expect(html).toContain('hk-cmi-edge-01');
    expect(html).toContain('节点域名');
    expect(html).toContain('hk.example.com');
    expect(html).toContain('亚太线路');
    expect(html).toContain('CN2 GIA');
    expect(html).toContain('node-hk-01');
    expect(html).toContain('费用与续期');
    expect(html).toContain('修改名称');
  });

  it('hides billing and security sections for viewer', () => {
    const html = renderSection(viewerSession, 'security');

    expect(html).not.toContain('凭据与安全');
    expect(html).not.toContain('费用与续期');
    expect(html).not.toContain('修改名称');
    expect(html).toContain('节点标识与分类');
  });

  it('renders traffic usage preview ahead of quota fields with calibration action', () => {
    const html = renderSection(adminSession, 'traffic');

    expect(html).toContain('同步状态与版本');
    expect(html).toContain('本周期用量预览');
    expect(html).toContain('校准本周期流量');
    expect(html).toContain('计费规则与统计网卡');
    expect(html).toContain('账期重置周期');
    expect(html.indexOf('本周期用量预览')).toBeLessThan(html.indexOf('计费规则与统计网卡'));
    expect(html).not.toContain('提交校准');
  });

  it('renders monitoring presets and collapsed global TCP probe state', () => {
    const html = renderSection(adminSession, 'monitoring');

    expect(html).toContain('同步状态与版本');
    expect(html).toContain('采集与上报频率');
    expect(html).toContain('标准平衡');
    expect(html).toContain('实时高频');
    expect(html).toContain('轻量节流');
    expect(html).toContain('TCP 延迟探测');
    expect(html).toContain('使用全局配置');
    expect(html).toContain('节点独立配置');
    expect(html).not.toContain('TCP 1 名称');
  });

  it('renders agent updates and log level together', () => {
    const html = renderSection(adminSession, 'agent');

    expect(html).toContain('同步状态与版本');
    expect(html).toContain('Agent 版本与更新');
    expect(html).toContain('自动更新 Agent');
    expect(html).toContain('节点运行日志等级');
    expect(html).toContain('WARN (推荐)');
  });

  it('renders danger zone in isolated security section for admin', () => {
    const html = renderSection(adminSession, 'security');

    expect(html).toContain('节点凭据与生命周期');
    expect(html).toContain('重新签发注册令牌');
    expect(html).toContain('吊销 Agent 凭据');
    expect(html).toContain('从控制面移除节点');
  });
});
