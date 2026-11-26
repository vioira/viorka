import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { TelemetrySettings } from '@/api/telemetry';
import TCPProbeQuality from './TCPProbeQuality';
import { useTCPProbeSettings } from './use-tcp-probe-settings';

vi.mock('./use-tcp-probe-settings', () => ({ useTCPProbeSettings: vi.fn() }));
vi.mock('./use-tcp-probe-history', () => ({
  useTCPProbeHistory: () => ({
    range: '1h',
    result: {
      range: '1h',
      data: {
        start: '2026-11-26T00:00:00Z',
        end: '2026-11-26T01:00:00Z',
        period_seconds: 60,
        points: [
          {
            sampled_at: '2026-11-26T00:01:00Z',
            targets: [
              { target: 'example.com:443', ping: -1, loss: 100 },
              { target: 'keep.example:80', ping: 31, loss: 0 },
            ],
          },
        ],
      },
    },
    live: [
      {
        sampled_at: '2026-11-26T00:59:00Z',
        targets: [{ target: 'example.com:443', ping: 99, loss: 0 }],
      },
    ],
  }),
}));

function render(config: TelemetrySettings['tcp_probe'], compact = true) {
  vi.mocked(useTCPProbeSettings).mockReturnValue({
    settings: {
      revision: 2,
      connection_mode: 'auto_http_wss',
      collection_seconds: 30,
      http_report_seconds: 60,
      wss_report_seconds: 2,
      tcp_probe: config,
    },
    error: '',
    reload: vi.fn(),
  });
  return renderToStaticMarkup(<TCPProbeQuality id="n" active now={0} compact={compact} />);
}

it.each([true, false])('概览与指标按当前目标匹配历史和实时采样 (compact=%s)', (compact) => {
  const html = render(
    {
      use_global: true,
      targets: ['example.com:8443', 'keep.example:80'],
      names: ['', '保留线路'],
    },
    compact,
  );
  expect(html.match(/<li\b/g)).toHaveLength(2);
  expect(html).not.toContain('example.com:443');
  expect(html).toMatch(/example\.com:8443<\/span><span[^>]*>未知</);
  expect(html).toMatch(/保留线路<\/span><span[^>]*>31\.0</);
});

it('清空全局或节点目标后隐藏已有探测数据', () => {
  for (const config of [undefined, { use_global: false, targets: [] }]) {
    const html = render(config);
    expect(html).toContain('尚未配置 TCP 探测目标');
    expect(html).not.toContain('example.com:443');
    expect(html).not.toContain('<li ');
  }
});
