import { Copy, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSettings } from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import { buildInstallScript, normalizeGitHubProxy } from './install-script';

const proxyOptions = [
  { value: 'direct', label: '直连 GitHub（默认）' },
  { value: 'https://ghfast.top', label: 'https://ghfast.top' },
  { value: 'https://ghproxy.net', label: 'https://ghproxy.net' },
  { value: 'https://gh.llkk.cc', label: 'https://gh.llkk.cc' },
  { value: 'https://gh-proxy.com', label: 'https://gh-proxy.com' },
  { value: 'custom', label: '自定义' },
];

export function InstallInstructions({
  token,
  reenrollNode,
  registration = false,
}: {
  token?: string;
  reenrollNode?: string;
  registration?: boolean;
}) {
  const [origin, setOrigin] = useState('');
  const [proxyChoice, setProxyChoice] = useState('direct');
  const [customProxy, setCustomProxy] = useState('');
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
        if (controller.signal.aborted) return;
        buildInstallScript(active_origin, token, reenrollNode, registration);
        setOrigin(active_origin);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '无法读取面板地址，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, reenrollNode, registration, attempt, setError]);

  const githubProxy =
    proxyChoice === 'custom' ? normalizeGitHubProxy(customProxy.trim()) : proxyChoice;
  const script =
    origin && githubProxy
      ? buildInstallScript(
          origin,
          token,
          reenrollNode,
          registration,
          githubProxy === 'direct' ? undefined : githubProxy,
        )
      : '';
  let unavailableReason = '安装命令不可用，请检查面板当前公开地址是否为 HTTPS。';
  if (loading) unavailableReason = '正在读取面板地址…';
  else if (origin && !githubProxy) unavailableReason = '请输入有效的 HTTPS 代理地址。';

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
        {registration
          ? '在每台目标 Linux 服务器执行即可注册。命令含批量令牌，请勿分享，执行后可能保存在终端历史中。'
          : token
            ? '在目标 Linux 节点执行以下命令，即可安装、注册并启动 Agent，无需再次输入令牌。'
            : '在目标 Linux 节点的交互终端执行以下命令，并按提示粘贴该节点的有效注册令牌。令牌输入时不会显示。'}
      </p>
      <div className="space-y-2">
        <Select
          label="GitHub 下载代理"
          options={proxyOptions}
          value={proxyChoice}
          onValueChange={setProxyChoice}
        />
        {proxyChoice === 'custom' && (
          <Input
            label="代理地址"
            placeholder="https://proxy.example.com/github"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            value={customProxy}
            aria-invalid={customProxy.length > 0 && !githubProxy}
            onChange={(event) => setCustomProxy(event.target.value)}
          />
        )}
        {proxyChoice !== 'direct' && (
          <p className="text-(length:--text-xs) text-text-secondary">
            请仅使用信任的代理，安装脚本和发布文件将通过该代理下载。
          </p>
        )}
      </div>
      <pre
        role="region"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the script region.
        tabIndex={0}
        aria-label="安装注册命令"
        className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-(--radius-md) bg-surface-muted p-4 text-(length:--text-xs)"
      >
        <code>{script || unavailableReason}</code>
      </pre>
      {!origin && (
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          重新读取面板地址
        </Button>
      )}
      <p className="text-(length:--text-xs) text-text-secondary">
        支持 Linux amd64/arm64，需要 curl 和
        sha256sum。安装后返回节点详情确认连接状态；前台模式需保持终端运行。私有 CA 可通过
        --ca-file=/绝对路径/ca.pem 指定。
      </p>
    </section>
  );
}
