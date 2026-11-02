import { describe, expect, it } from 'vitest';
import {
  bytes,
  diskPercent,
  filesystemTotal,
  isMonitoringSnapshot,
  isStale,
  type MonitoringSnapshot,
  percent,
  recentSeries,
} from './monitoring';

const time = '2026-01-01T00:00:00Z';
const snapshot: MonitoringSnapshot = {
  received_at: time,
  stale: false,
  history: [],
  latest: {
    sampled_at: time,
    interval_seconds: 30,
    errors: [],
    interfaces: [],
    cpu: { logical_cpus: 2, usage_percent: 0 },
  },
};
describe('monitoring truthfulness', () => {
  it('retains real zero but never invents missing values', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(undefined)).toBe('未知');
    expect(percent(undefined, 100)).toBeNull();
    expect(percent(0, 100)).toBe(0);
    expect(isMonitoringSnapshot(snapshot)).toBe(true);
  });
  it('marks data stale on age or disconnect even if CPU is zero', () => {
    expect(isStale(snapshot, Date.parse(time) + 90000)).toBe(false);
    expect(isStale(snapshot, Date.parse(time) + 91000)).toBe(true);
    expect(isStale({ ...snapshot, stale: true }, Date.parse(time))).toBe(true);
    expect(isStale(undefined, 0)).toBe(true);
  });
  it('rejects malformed payloads without replacing inventory with a fake success', () => {
    for (const v of [
      null,
      {},
      { ...snapshot, history: null },
      { ...snapshot, latest: { ...snapshot.latest, cpu: null } },
      { ...snapshot, latest: { ...snapshot.latest, cpu: { logical_cpus: 2, usage_percent: 101 } } },
      { ...snapshot, latest: { ...snapshot.latest, interfaces: [null] } },
    ])
      expect(isMonitoringSnapshot(v)).toBe(false);
  });
  it('does not connect a chart across missing counters or offline time', () => {
    const points = [
      { at: time, cpu: 20 },
      { at: '2026-01-01T00:01:00Z' },
      { at: '2026-01-01T00:02:00Z', cpu: 0 },
    ];
    expect(recentSeries(points, 'cpu')).toEqual([points[2]]);
    expect(recentSeries(points.slice(0, 2), 'cpu')).toEqual([]);
    expect(
      recentSeries(
        [
          { at: time, cpu: 20 },
          { at: '2026-01-01T00:05:00Z', cpu: 30 },
        ],
        'cpu',
      ),
    ).toHaveLength(1);
  });
});

it('uses the negotiated report interval for freshness', () => {
  const at = '2026-01-01T00:00:00Z';
  const slow = {
    received_at: at,
    stale: false,
    history: [],
    report_interval_seconds: 300,
    latest: { sampled_at: at, interval_seconds: 10, errors: [], interfaces: [] },
  };
  expect(isStale(slow, Date.parse(at) + 300_000)).toBe(false);
  expect(isStale(slow, Date.parse(at) + 901_000)).toBe(true);
});

it('validates the optional host extension and preserves legacy snapshots', () => {
  const host = {
    disk_io: [{ device: 'sda', read_bytes: 0, write_bytes: 0 }],
    errors: [],
    processes: 0,
    tcp_sockets: 0,
    udp_sockets: 0,
  };
  const withHost = (value: unknown) => ({
    ...snapshot,
    latest: { ...snapshot.latest, host: value },
  });
  expect(isMonitoringSnapshot(withHost(host))).toBe(true);
  expect(isMonitoringSnapshot(snapshot)).toBe(true);
  for (const invalid of [
    null,
    { ...host, processes: -1 },
    { ...host, tcp_sockets: 0.5 },
    { ...host, disk_io: [null] },
    { ...host, disk_io: [{ ...host.disk_io[0], read_bytes_per_second: Infinity }] },
  ]) {
    expect(isMonitoringSnapshot(withHost(invalid))).toBe(false);
  }
});

describe('filesystem capacity', () => {
  const root = { total_bytes: 16729894912, used_bytes: 5124399104, available_bytes: 10729725952 };
  const data = { total_bytes: 21474836480, used_bytes: 4402341478, available_bytes: 16000000000 };
  const filesystems = {
    mounts: [
      { mount_point: '/', filesystem_type: 'ext4', usage: root },
      { mount_point: '/data', filesystem_type: 'ext4', usage: data },
    ],
    errors: [],
  };
  it('includes data disk, retains reserved blocks and matches df percentage', () => {
    expect(filesystemTotal(filesystems)?.total_bytes).toBe(root.total_bytes + data.total_bytes);
    expect(filesystemTotal(filesystems)?.available_bytes).toBe(
      root.available_bytes + data.available_bytes,
    );
    expect(diskPercent(root)).toBe(33);
    expect(isMonitoringSnapshot({ ...snapshot, latest: { ...snapshot.latest, filesystems } })).toBe(
      true,
    );
  });
  it('reports unavailable inventory as unknown and rejects inconsistent data', () => {
    expect(filesystemTotal(undefined)).toBeUndefined();
    expect(filesystemTotal({ mounts: [], errors: ['filesystems_unavailable'] })).toBeUndefined();
    expect(diskPercent(undefined)).toBeUndefined();
    for (const f of [
      null,
      { mounts: [null], errors: [] },
      { ...filesystems, errors: ['filesystems_unavailable'] },
      { ...filesystems, mounts: [filesystems.mounts[0], filesystems.mounts[0]] },
    ]) {
      expect(
        isMonitoringSnapshot({ ...snapshot, latest: { ...snapshot.latest, filesystems: f } }),
      ).toBe(false);
    }
  });
});
