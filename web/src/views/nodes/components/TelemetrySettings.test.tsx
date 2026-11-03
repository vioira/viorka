import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@/api/auth';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import TelemetrySettings from './TelemetrySettings';

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useOutletContext: () =>
      ({
        user: { id: 'admin-1', username: 'admin', role: 'admin' },
        csrf_token: 'test-token',
      }) as Session,
  };
});

vi.mock('@/api/telemetry-settings', () => ({
  getTelemetrySettings: vi.fn().mockResolvedValue({
    revision: 2,
    log_level: 'warn',
    collection_seconds: 30,
    http_report_seconds: 60,
    wss_report_seconds: 2,
    traffic: {
      interfaces: 'eth0',
      reset_day: 1,
      reset_hour: 0,
      reset_minute: 0,
      timezone: 'UTC',
      billing_mode: 'both',
      quota_bytes: '0',
    },
  }),
  getTelemetrySettingsStatus: vi.fn().mockResolvedValue({
    state: 'applied',
    applied_revision: 2,
  }),
  saveTelemetrySettings: vi.fn(),
  telemetrySettingsState: vi.fn().mockReturnValue('applied'),
}));

vi.mock('@/hooks/realtime', () => ({
  useServerEvent: vi.fn(),
}));

describe('TelemetrySettings view', () => {
  it('renders sync status, timing presets, and section titles', () => {
    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <MemoryRouter>
          <TelemetrySettings
            id="node-test-1"
            negotiated={true}
            applied={{
              revision: 2,
              log_level: 'warn',
              connection_mode: 'auto_http_wss',
              collection_seconds: 30,
              http_report_seconds: 60,
              wss_report_seconds: 2,
            }}
          />
        </MemoryRouter>
      </ToastStackProvider>,
    );

    expect(html).toContain('同步状态与版本');
    expect(html).toContain('监控采集与上报策略');
    expect(html).toContain('标准平衡 (30s / 60s / 2s)');
    expect(html).toContain('实时高频 (10s / 30s / 1s)');
    expect(html).toContain('轻量节流 (60s / 180s / 5s)');
    expect(html).toContain('节点运行日志等级');
    expect(html).toContain('流量统计与账期配额');
    expect(html).toContain('本周期流量手动校准');
    expect(html).toContain('重新读取设置');
  });
});
