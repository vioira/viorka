import { Code2 } from 'lucide-react';
import type { PresetConfig } from '@/api/protocol-presets';

export default function PresetPreview({
  value,
  referenceable,
}: {
  value: PresetConfig;
  referenceable: boolean;
}) {
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
    query.set('sid', 'SHORT_ID');
  }
  const preview = `vless://UUID@${value.cdn_host || 'node.example.com'}:${value.port || '{端口}'}?${query.toString()}#${encodeURIComponent(value.name || 'VLESS')}`;
  return (
    <aside
      className="min-w-0 self-start rounded-(--radius-panel) border-[1px] border-border bg-surface p-5 sm:p-6 xl:sticky xl:top-4"
      aria-label="客户端连接预览"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 font-medium">
          <Code2 size={18} strokeWidth={1.75} aria-hidden="true" />
          客户端连接预览
        </h2>
        <span className="text-(length:--text-xs) text-text-secondary">VLESS URI</span>
      </div>
      <pre className="mt-5 whitespace-pre-wrap break-all rounded-(--radius-control) border-[1px] border-border bg-background p-4 font-mono text-(length:--text-xs) leading-7 text-foreground">
        {preview}
      </pre>
      <p className="mt-4 text-(length:--text-xs) leading-relaxed text-text-secondary">
        链接结构示意。节点入口和凭证在创建服务后确定，实际连接链接需等待节点确认应用。
      </p>
      <div className="mt-5 space-y-2 border-t-[1px] border-border pt-5">
        <h3 className="font-medium">节点引用</h3>
        <p className="text-(length:--text-xs) leading-relaxed text-text-secondary">
          {referenceable
            ? '可用于 sing-box / Xray，服务复用预设中的全部 Short ID。选择节点并填入草稿后，单独应用配置。'
            : '此组合可保存为预设，暂不支持节点引用。当前支持 TCP + REALITY、外部站点、Chrome 指纹与有效的 Short ID（留空时自动生成）。'}
        </p>
      </div>
    </aside>
  );
}
