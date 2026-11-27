import type { Outbound, OutboundConfig } from '@/api/outbounds';

import { validHost } from '@/utils/endpoint-host';

export type OutboundDraft = Omit<OutboundConfig, 'server_port'> & { server_port: string };

const bytes = new TextEncoder();
type Issue = { field: keyof OutboundDraft; message: string };

export function validateOutboundDraft(c: OutboundDraft, saved: Outbound | null): Issue | undefined {
  if (
    !c.name ||
    c.name !== c.name.trim() ||
    /\p{Cc}/u.test(c.name) ||
    bytes.encode(c.name).length > 128
  )
    return { field: 'name', message: '请输入 1 至 128 字节的出口名称，去掉首尾空白和控制字符。' };
  if (!validHost(c.server))
    return {
      field: 'server',
      message: '服务器地址须为域名、完整的四段 IPv4 或 IPv6 地址，端口请单独填写。',
    };
  if (
    !/^\d{1,5}$/.test(c.server_port) ||
    Number(c.server_port) < 1 ||
    Number(c.server_port) > 65535
  )
    return { field: 'server_port', message: '服务器端口须为 1 至 65535 的十进制整数。' };

  const sameProtocol = saved?.config.type === c.type;
  if (c.type === 'vless') {
    const keepUUID = sameProtocol && saved?.has_uuid && !c.uuid;
    if (!keepUUID && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(c.uuid ?? ''))
      return { field: 'uuid', message: '请输入完整的 UUID，格式为 8-4-4-4-12 位十六进制字符。' };
    if (!c.tls) return;
    if (!validHost(c.server_name ?? ''))
      return { field: 'server_name', message: '请为 REALITY 填写有效的 SNI 服务器名称。' };
    if (!/^(?:[\da-f]{2}){0,8}$/i.test(c.short_id ?? ''))
      return {
        field: 'short_id',
        message: 'Short ID 可留空，填写时须为偶数位十六进制字符，最多 16 位。',
      };
    if (!/^[\w-]{43}$/.test(c.public_key ?? ''))
      return { field: 'public_key', message: 'REALITY 公钥须为 43 位无填充 Base64URL 字符。' };
    return;
  }

  if (bytes.encode(c.username ?? '').length > 256)
    return { field: 'username', message: '用户名最多 256 字节。' };
  if (bytes.encode(c.password ?? '').length > 1024)
    return { field: 'password', message: '密码最多 1024 字节。' };
  if (c.password && !c.username)
    return { field: 'username', message: '已填写密码，请填写用户名，或清空密码以取消认证。' };
  if (c.username && !c.password && !(sameProtocol && saved?.has_password))
    return { field: 'password', message: '已填写用户名，请填写该出口的密码。' };
  if (c.type === 'http' && c.tls && c.server_name && !validHost(c.server_name))
    return { field: 'server_name', message: 'TLS 服务器名称须为有效的域名或 IP 地址，也可留空。' };
}
