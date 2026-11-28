import { type Endpoint, type RelayRoute, relayTargetsPreviousLanding } from '@/api/relays';

export interface SelectableRelayOption {
  route: RelayRoute;
  endpoint: Endpoint | null;
  selectable: boolean;
  verified: boolean;
  caveat: string;
}

export function formatAuthorityHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.includes(':') && !trimmed.startsWith('[')) {
    return `[${trimmed}]`;
  }
  return trimmed;
}

export function extractConnectionEndpoint(rawUrl: string): string {
  const schemeEnd = rawUrl.indexOf('://');
  if (schemeEnd === -1) return '';
  const authorityStart = schemeEnd + 3;
  const queryStart = rawUrl.indexOf('?', authorityStart);
  const hashStart = rawUrl.indexOf('#', authorityStart);
  const authorityEnd = [queryStart, hashStart]
    .filter((index) => index !== -1)
    .reduce((min, index) => Math.min(min, index), rawUrl.length);
  const authority = rawUrl.slice(authorityStart, authorityEnd);
  const atIndex = authority.lastIndexOf('@');
  return atIndex >= 0 ? authority.slice(atIndex + 1) : authority;
}

export function relayFragmentName(route: RelayRoute, routeName: string): string {
  const trimmedName = routeName.trim();
  const entry = route.entry_name.trim();
  if (!entry) return trimmedName;
  if (!trimmedName) return entry;
  if (trimmedName.toLocaleLowerCase().includes(entry.toLocaleLowerCase())) {
    return trimmedName;
  }
  return `${entry} / ${trimmedName}`;
}

export function buildRelayConnectionUrl(
  directUrl: string,
  publicEndpoint: Endpoint,
  fragmentName?: string,
): string {
  if (!publicEndpoint.host.trim() || publicEndpoint.port <= 0) return directUrl;
  const schemeEnd = directUrl.indexOf('://');
  if (schemeEnd === -1) return directUrl;
  const authorityStart = schemeEnd + 3;
  const queryStart = directUrl.indexOf('?', authorityStart);
  const hashStart = directUrl.indexOf('#', authorityStart);
  const authorityEnd = [queryStart, hashStart]
    .filter((index) => index !== -1)
    .reduce((min, index) => Math.min(min, index), directUrl.length);

  const authority = directUrl.slice(authorityStart, authorityEnd);
  const atIndex = authority.lastIndexOf('@');
  const userInfoPrefix = atIndex >= 0 ? authority.slice(0, atIndex + 1) : '';
  const queryEnd = hashStart !== -1 && hashStart > queryStart ? hashStart : directUrl.length;
  const queryPart = queryStart !== -1 ? directUrl.slice(queryStart, queryEnd) : '';
  const existingFragment = hashStart !== -1 ? directUrl.slice(hashStart) : '';
  const nextFragment = fragmentName ? `#${encodeURIComponent(fragmentName)}` : existingFragment;
  const nextHostPort = `${formatAuthorityHost(publicEndpoint.host)}:${publicEndpoint.port}`;

  return `${directUrl.slice(0, authorityStart)}${userInfoPrefix}${nextHostPort}${queryPart}${nextFragment}`;
}

export function classifyRelayOptions(routes: RelayRoute[]): SelectableRelayOption[] {
  const mapped = routes.map((route): SelectableRelayOption => {
    if (route.cleanup_only || route.reason === 'permission_lost') {
      return {
        route,
        endpoint: null,
        selectable: false,
        verified: false,
        caveat: '落地导出权限已失效',
      };
    }
    if (route.stopped_at || route.reason === 'disabled') {
      return {
        route,
        endpoint: route.published?.public ?? route.draft.public,
        selectable: false,
        verified: false,
        caveat: '线路已停用',
      };
    }
    if (relayTargetsPreviousLanding(route)) {
      return {
        route,
        endpoint: null,
        selectable: false,
        verified: false,
        caveat: '当前线路仍指向原落地服务',
      };
    }
    if (route.reason === 'landing_changed') {
      return {
        route,
        endpoint: route.published?.public ?? route.draft.public,
        selectable: false,
        verified: false,
        caveat: '落地连接已变化，需重新编辑发布',
      };
    }
    if (
      route.reason === 'available' &&
      route.serving_path?.public.host &&
      route.serving_path.public.port > 0
    ) {
      const caveat = !route.online
        ? '入口节点当前离线，沿用上次确认的公网入口'
        : route.public_stale
          ? '公网验证已超过 24 小时，建议重新检测'
          : '已通过入口拨号与公网 TCP 验证';
      return {
        route,
        endpoint: route.serving_path.public,
        selectable: true,
        verified: true,
        caveat,
      };
    }
    if (route.published?.public.host && route.published.public.port > 0) {
      return {
        route,
        endpoint: route.published.public,
        selectable: true,
        verified: false,
        caveat: '尚未通过公网验证，当前链接仅供手动测试与排查',
      };
    }
    return {
      route,
      endpoint: route.draft.public,
      selectable: false,
      verified: false,
      caveat: '草稿尚未发布到入口节点',
    };
  });

  // Sort order: verified available first, then selectable published, then unavailable.
  return mapped.sort((a, b) => {
    const rank = (item: SelectableRelayOption) => (item.verified ? 0 : item.selectable ? 1 : 2);
    return rank(a) - rank(b);
  });
}
