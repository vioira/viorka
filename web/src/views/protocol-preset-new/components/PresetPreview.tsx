import { engineNames } from '@/api/engines';
import type { PresetConfig } from '@/api/protocol-presets';
import { Badge } from '@/components/arc/badge/badge';

function evaluateCompatibility(value: PresetConfig, canReference: boolean) {
  const issues: Record<(typeof engineNames)[number], string> = {
    'sing-box': '',
    xray: '',
    realm: 'Realm 仅支持转发服务，不支持 VLESS 协议预设',
  };

  if (value.security === 'tls') {
    const message = '当前执行链路暂未接入 TLS 证书管理';
    issues['sing-box'] = message;
    issues.xray = message;
  } else if (value.transport === 'xhttp') {
    issues['sing-box'] = 'sing-box 引擎不支持 XHTTP 传输';
    issues.xray = 'Xray 执行链路暂未接入 XHTTP';
  } else if (value.transport === 'ws') {
    const message = 'WebSocket 仅可搭配 TLS';
    issues['sing-box'] = message;
    issues.xray = message;
  } else if (value.site !== 'external') {
    const message = '当前执行链路仅支持外部握手目标站点';
    issues['sing-box'] = message;
    issues.xray = message;
  } else if (value.fingerprint !== 'chrome') {
    const message = '当前执行链路仅支持 Chrome 客户端指纹';
    issues['sing-box'] = message;
    issues.xray = message;
  } else if (!canReference) {
    const message = '当前配置缺少可引用的 Short ID';
    issues['sing-box'] = message;
    issues.xray = message;
  }

  return issues;
}

export default function PresetPreview({
  value,
  referenceable,
  invalid,
  firstShortID,
}: {
  value: PresetConfig;
  referenceable: boolean;
  invalid: boolean;
  firstShortID: string;
}) {
  const issues = evaluateCompatibility(value, referenceable);
  const query = new URLSearchParams({
    encryption: 'none',
    type: value.transport,
    security: value.security,
    fp: value.fingerprint,
  });
  if (value.transport === 'tcp') query.set('flow', 'xtls-rprx-vision');
  else query.set('path', value.path || '/');
  if (value.transport === 'xhttp') query.set('mode', 'auto');
  query.set('sni', value.server_name || 'node.example.com');
  if (value.security === 'reality') {
    query.set('pbk', 'PUBLIC_KEY');
    query.set('sid', firstShortID || 'AUTO_SHORT_ID');
  }
  const preview = `vless://UUID@${value.cdn_host || 'node.example.com'}:${value.port || '{端口}'}?${query.toString()}#${encodeURIComponent(value.name || 'VLESS')}`;

  return (
    <aside
      className="min-w-0 space-y-4 self-start xl:sticky xl:top-4"
      aria-label="实时兼容性与示意"
    >
      <section className="overflow-hidden rounded-(--radius-surface) border-[1px] border-border bg-surface">
        <div className="flex items-center justify-between gap-2 border-b-[1px] border-border-subtle px-5 py-3.5">
          <h3 className="text-(length:--text-sm) font-medium text-foreground">
            实时引擎引用兼容性
          </h3>
          <Badge size="sm" tone={referenceable ? 'success' : 'neutral'} dot={referenceable}>
            {invalid ? '参数待完善' : referenceable ? '可引用' : '仅保存预设'}
          </Badge>
        </div>
        <dl className="divide-y-[1px] divide-border-subtle">
          {engineNames.map((engine) => {
            const issue = invalid && engine !== 'realm' ? '请先完善协议参数' : issues[engine];
            return (
              <div key={engine} className="flex items-start justify-between gap-3 px-5 py-3">
                <dt className="shrink-0 text-(length:--text-xs) font-medium text-foreground">
                  {engine}
                </dt>
                <dd
                  className={`text-right text-(length:--text-xs) ${
                    issue ? 'text-text-secondary' : 'font-medium text-success'
                  }`}
                >
                  {issue || '可用于节点草稿'}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="space-y-3 rounded-(--radius-surface) border-[1px] border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-(length:--text-sm) font-medium text-foreground">URI 结构示意</h3>
          <span className="text-(length:--text-xs) text-text-secondary">非可用链接</span>
        </div>
        <pre className="whitespace-pre-wrap break-all rounded-(--radius-control) border-[1px] border-border bg-background p-3.5 font-mono text-(length:--text-xs) leading-relaxed text-foreground">
          {preview}
        </pre>
        <p className="text-(length:--text-xs) leading-relaxed text-text-secondary">
          节点对外地址、UUID 与 REALITY 公钥在节点创建服务并确认应用后生成。
        </p>
      </section>
    </aside>
  );
}
