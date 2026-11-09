import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultTrafficSettings } from '@/api/traffic';
import TrafficSettingsFields, { trafficSettings, trafficValues } from './TrafficSettingsFields';

describe('TrafficSettingsFields', () => {
  it('extracts and builds default traffic values', () => {
    const values = trafficValues(defaultTrafficSettings);
    expect(values).toEqual({
      interfaces: '',
      day: '1',
      time: '00:00',
      timezone: 'UTC',
      quota: '0',
      billing: 'both',
    });
  });

  it('converts edited values to TrafficSettings object', () => {
    const updated = trafficSettings({
      interfaces: 'eth1, eth0',
      day: '15',
      time: '04:30',
      timezone: 'Asia/Shanghai',
      quota: '500',
      billing: 'outbound',
    });
    expect(trafficValues({ ...defaultTrafficSettings, quota_bytes: '1500000000' }).quota).toBe(
      '1.5',
    );
    expect(updated).toEqual({
      interfaces: 'eth0,eth1',
      reset_day: 15,
      reset_hour: 4,
      reset_minute: 30,
      timezone: 'Asia/Shanghai',
      billing_mode: 'outbound',
      quota_bytes: '500000000000',
    });
  });

  it('renders billing settings and usage preview', () => {
    const html = renderToStaticMarkup(
      <TrafficSettingsFields
        values={{
          interfaces: 'eth0',
          day: '1',
          time: '00:00',
          timezone: 'Asia/Shanghai',
          quota: '1000',
          billing: 'both',
        }}
        onChange={() => {}}
        traffic={{
          month_start: '2026-11-01T00:00:00Z',
          period_end: '2026-12-01T00:00:00Z',
          rx_bytes: '107374182400', // 100 GiB
          tx_bytes: '53687091200', // 50 GiB
          filter_revision: '1',
          quality: [],
        }}
      />,
    );

    expect(html).toContain('统计网卡');
    expect(html).toContain('使用默认网卡');
    expect(html).toContain('每月重置日期');
    expect(html).toContain('重置时间');
    expect(html).toContain('计费时区');
    expect(html).toContain('Asia/Shanghai');
    expect(html).toContain('用量预览');
    expect(html).toContain('53.7 GB');
    expect(html).toContain('107.4 GB');
    expect(html).toContain('发送（TX）');
    expect(html).toContain('接收（RX）');
  });
  it('uses only outbound traffic for outbound quota and preserves unknown usage', () => {
    const render = (traffic?: Parameters<typeof TrafficSettingsFields>[0]['traffic']) =>
      renderToStaticMarkup(
        <TrafficSettingsFields
          values={{ ...trafficValues(), quota: '100', billing: 'outbound' }}
          onChange={() => {}}
          traffic={traffic}
        />,
      );
    expect(
      render({
        month_start: '2026-11-01T00:00:00Z',
        rx_bytes: '90000000000',
        tx_bytes: '20000000000',
        filter_revision: '1',
        quality: [],
      }),
    ).toContain('剩余 80.00 GB');
    expect(render()).toContain('等待有效流量数据');
  });
});
