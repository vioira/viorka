import type { PresetConfig } from '@/api/protocol-presets';
import { validDNSHost, validHost } from '@/utils/endpoint-host';

export type PresetDraft = Omit<PresetConfig, 'port'> & { port: string };
export interface ShortIDField {
  id: number;
  value: string;
}

const encoder = new TextEncoder();
function targetHost(target: string) {
  const match = /^(?:\[([\da-f:.]+)\]|([^:[\]]+)):(\d+)$/i.exec(target);
  if (!match || Number(match[3]) < 1 || Number(match[3]) > 65535) return '';
  const host = match[1] ?? match[2];
  if (match[1] && !host.includes(':')) return '';
  return validHost(host) ? host : '';
}

export function defaultSNI(target: string) {
  const host = targetHost(target);
  return validDNSHost(host) ? host : '';
}

export function presetDraft(config: PresetConfig): PresetDraft {
  const inheritsSNI =
    config.security === 'reality' &&
    config.site === 'external' &&
    config.server_name === defaultSNI(config.target);
  return {
    ...config,
    port: String(config.port),
    server_name: inheritsSNI ? '' : config.server_name,
  };
}

export function presetConfig(draft: PresetDraft, shortIDs: ShortIDField[]): PresetConfig {
  return {
    ...draft,
    port: Number(draft.port),
    server_name:
      draft.server_name ||
      (draft.security === 'reality' && draft.site === 'external' ? defaultSNI(draft.target) : ''),
    short_ids: shortIDs.map(({ value }) => value.trim().toLowerCase()).filter(Boolean),
  };
}

export function validatePresetDraft(draft: PresetDraft, shortIDs: ShortIDField[]) {
  if (
    !draft.name ||
    draft.name !== draft.name.trim() ||
    /\p{Cc}/u.test(draft.name) ||
    encoder.encode(draft.name).length > 128
  )
    return { field: 'name', message: '配置名称须为 1 至 128 字节，请去掉首尾空白或控制字符。' };
  if (!/^\d{1,5}$/.test(draft.port) || Number(draft.port) < 1 || Number(draft.port) > 65535)
    return { field: 'port', message: '默认 TCP 端口须为 1 至 65535 的十进制整数。' };
  if (
    draft.transport !== 'tcp' &&
    (!draft.path.startsWith('/') ||
      /[?#\p{White_Space}\p{Cc}]/u.test(draft.path) ||
      encoder.encode(draft.path).length > 256)
  )
    return {
      field: 'path',
      message: '传输路径须以 / 开头，最多 256 字节，不能包含空白、控制字符、? 或 #。',
    };
  if (draft.security === 'reality' && draft.site === 'external') {
    const host = targetHost(draft.target);
    if (!host)
      return {
        field: 'target',
        message:
          '握手目标须包含有效地址和 1 至 65535 的端口，例如 example.org:443 或 [2001:db8::1]:443。',
      };
    if (!draft.server_name && !validDNSHost(host))
      return { field: 'server_name', message: '握手目标为 IP 地址时，请单独填写域名作为 SNI。' };
  }
  if (draft.server_name && !validDNSHost(draft.server_name))
    return { field: 'server_name', message: 'SNI 须为有效的域名，不可填写 IP 地址、端口或网址。' };
  if (draft.security === 'tls') {
    if ((draft.cdn_host || draft.certificate === 'self_signed') && !validDNSHost(draft.cdn_host))
      return { field: 'cdn_host', message: '请填写有效的 CDN 主机域名，自签名证书必须指定此项。' };
  } else {
    const seen = new Set<string>();
    for (const [index, field] of shortIDs.entries()) {
      const id = field.value.trim().toLowerCase();
      if (!id) continue;
      const name = `short-id-${field.id}`;
      if (!/^(?:[\da-f]{2}){1,8}$/.test(id))
        return {
          field: name,
          message: `第 ${index + 1} 个 Short ID 须为 2 至 16 位偶数长度的十六进制字符。`,
        };
      if (seen.has(id))
        return { field: name, message: `第 ${index + 1} 个 Short ID 重复，请修改或移除。` };
      if (seen.size === 8) return { field: name, message: 'Short ID 最多填写 8 个。' };
      seen.add(id);
    }
  }
}
