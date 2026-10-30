import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSettings } from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import { buildInstallScript } from './install-script';

export function InstallInstructions({ token }: { token: string }) {
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
        if (!controller.signal.aborted) setScript(buildInstallScript(active_origin, token));
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '无法读取面板地址，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, attempt, setError]);
  return (
    <section aria-label="安装并注册节点" className="min-w-0 space-y-3" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">安装并注册节点</h3>
        <Button
          disabled={!script || loading}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(script);
              setNotice('安装命令已复制。');
            } catch {
              setError('无法访问剪贴板，请选中命令后手动复制。');
            }
          }}
        >
          <Copy size={16} aria-hidden="true" />
          复制安装命令
        </Button>
      </div>
      <p className="text-(length:--text-xs) text-text-secondary">
        在目标 Linux 节点执行以下命令，即可安装、注册并启动 Agent，无需再次输入令牌。
      </p>
      <pre
        role="region"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the script region.
        tabIndex={0}
        aria-label="安装注册命令"
        className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-(--radius-md) bg-surface-muted p-4 text-(length:--text-xs)"
      >
        <code>
          {script ||
            (loading
              ? '正在读取面板地址…'
              : '安装命令不可用，请检查面板当前公开地址是否为 HTTPS。')}
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
        支持 Linux amd64/arm64，需要 curl 和
        sha256sum。注册后请保持终端运行，返回节点列表确认在线。私有 CA 可通过
        --ca-file=/绝对路径/ca.pem 指定。
      </p>
    </section>
  );
}
