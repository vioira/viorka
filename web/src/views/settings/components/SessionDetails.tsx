import type { SessionRecord } from '@/api/login-security';

const reasons: Record<string, string> = {
  logout: '主动退出',
  logout_all: '退出全部会话',
  revoked: '会话已撤销',
  expired: '会话到期',
  password_changed: '密码已修改',
  role_changed: '角色已变更',
  account_disabled: '账户已禁用',
};
export function time(value: string) {
  return value ? new Date(value).toLocaleString() : '未记录';
}
export function device(ua: string) {
  const browser = ua.match(/(Edg)\/([\d.]+)/) ?? ua.match(/(Firefox|Chrome|Version)\/([\d.]+)/);
  const names: Record<string, string> = { Edg: 'Edge', Version: 'Safari' };
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '未知系统';
  return `${browser ? `${names[browser[1]] ?? browser[1]} ${browser[2]}` : '未知浏览器'} / ${os}`;
}
export default function SessionDetails({ record }: { record: SessionRecord }) {
  const fields = [
    ['会话 ID', record.id],
    ['登录用户', record.username],
    ['登录方式', record.method === 'passkey' ? '通行密钥' : '账户密码'],
    ['登录来源', record.source || '未记录'],
    ['用户 ID', record.user_id],
    ['首次登录 IP', record.first_ip || '未记录'],
    ['首次登录归属地', record.first_location || '归属地未知'],
    ['最新 IP', record.latest_ip || '未记录'],
    ['最新归属地', record.latest_location || '归属地未知'],
    [
      '设备类型',
      !record.user_agent
        ? '未知'
        : /Mobile|Android|iPhone|iPad/.test(record.user_agent)
          ? '移动设备'
          : '电脑',
    ],
    ['登录时间', time(record.created_at)],
    ['最近活动', time(record.last_active_at)],
    ['到期时间', time(record.expires_at)],
    ['结束时间', record.ended_at ? time(record.ended_at) : '尚未结束'],
    ['结束原因', reasons[record.end_reason] || (record.ended_at ? '未记录' : '会话有效')],
  ];
  return (
    <div className="space-y-6 text-(length:--text-sm)">
      <p>
        {record.current ? '当前会话 / ' : ''}
        {record.ended_at ? '已结束' : '有效'}
      </p>
      <section aria-label="登录身份与来源">
        <h3 className="mb-4 font-medium">登录身份与来源</h3>
        <dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-text-secondary">{label}</dt>
              <dd className="mt-1 wrap-anywhere tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label="User-Agent">
        <h3 className="mb-2 font-medium">User-Agent</h3>
        <p className="wrap-anywhere text-text-secondary">{record.user_agent || '未记录'}</p>
      </section>
      <section aria-label="会话 IP 历史">
        <h3 className="font-medium">会话 IP 历史</h3>
        <p className="mt-2 text-text-secondary">
          相同 IP 合并，显示最近使用的 100 个地址。归属地为近似值。
        </p>
        <ul className="mt-4 divide-y-[1px] divide-border">
          {record.ips.map((ip) => (
            <li key={ip.ip} className="space-y-2 py-4">
              <p className="wrap-anywhere font-mono">{ip.ip}</p>
              <p className="text-text-secondary">{ip.location || '归属地未知'}</p>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-text-secondary">首次使用</dt>
                  <dd className="tabular-nums">{time(ip.first_used_at)}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">最近使用</dt>
                  <dd className="tabular-nums">{time(ip.last_used_at)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        {record.ips.length === 0 && <p>未记录 IP</p>}
      </section>
    </div>
  );
}
