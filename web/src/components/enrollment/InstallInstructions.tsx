import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSettings } from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import { buildInstallScript } from './install-script';

export function InstallInstructions({ name }: { name: string }) {
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [, setError] = useToastFeedback('error');
  const [, setNotice] = useToastFeedback('success');
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries a failed settings request.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getSettings(controller.signal)
      .then(({ active_origin }) => {
        if (!controller.signal.aborted) setScript(buildInstallScript(active_origin, name));
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '无法读取面板地址，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [name, attempt, setError]);
  return (
    <section aria-label="安装并注册节点" className="min-w-0 space-y-3" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">安装并注册节点</h3>
        <Button
          disabled={!script || loading}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(script);
              setNotice('安装脚本已复制。');
            } catch {
              setError('无法访问剪贴板，请选中脚本后手动复制。');
            }
          }}
        >
          <Copy size={16} aria-hidden="true" />
          复制一键脚本
        </Button>
      </div>
      <p className="text-(length:--text-xs) text-text-secondary">
        在目标 Linux 节点粘贴执行，按提示输入上方令牌。脚本自动识别 amd64/arm64，从 GitHub Releases
        下载正式二进制并校验 SHA-256，完成安装、注册和启动。需要 Bash、curl 和 sha256sum。
      </p>
      <pre
        role="region"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the script region.
        tabIndex={0}
        aria-label="一键安装注册脚本"
        className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-(--radius-md) bg-surface-muted p-4 text-(length:--text-xs)"
      >
        <code>
          {script ||
            (loading
              ? '正在读取面板地址…'
              : '安装脚本不可用，请检查面板当前公开地址是否为 HTTPS。')}
        </code>
      </pre>
      {!script && (
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          重新读取面板地址
        </Button>
      )}
      <p className="text-(length:--text-xs) text-text-secondary">
        需先发布 GitHub Release 安装包。注册后在前台启动 Agent，请保持终端运行。私有 CA
        需先配置系统信任。返回节点列表刷新，确认真实连接状态。
      </p>
    </section>
  );
}
