import { RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { useRevalidator, useRouteError } from 'react-router';
import { ApiError } from '@/api/client';
import { Button } from '@/components/arc/button/button';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

function RouteStatus({
  title,
  message,
  actionLabel,
  retry,
  checking = false,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  retry?: () => void;
  checking?: boolean;
}) {
  return (
    <main className="grid min-h-svh place-items-center bg-background p-6 font-ui text-foreground">
      <div className="w-full max-w-88 rounded-(--radius-panel) border border-border bg-surface px-6 py-7 sm:px-8">
        <div className="flex items-center gap-2.5">
          <img src="/image/viorka.svg" alt="" width="32" height="28" />
          <span className="text-(length:--text-lg) font-medium">Viorka</span>
        </div>
        <div className="mt-5 border-t border-border pt-5">
          <h1 className="m-0 text-(length:--text-xl) font-medium">{title}</h1>
          <p role="status" className="mt-2 text-(length:--text-sm) text-text-secondary">
            {message}
          </p>
          <div className="mt-5 flex min-h-(--control-height-md) items-center">
            {retry && (
              <Button variant="secondary" loading={checking} onClick={retry}>
                <RotateCw size={16} aria-hidden="true" />
                {actionLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export function RouteError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const [, reportError] = useToastFeedback('error');
  useEffect(() => {
    reportError(error instanceof ApiError ? error.message : '页面未能正常显示，请重新加载。');
  }, [error, reportError]);
  if (!(error instanceof ApiError)) {
    return (
      <RouteStatus
        title="页面加载失败"
        message="请重新加载当前页面。"
        actionLabel="重新加载页面"
        retry={() => window.location.reload()}
      />
    );
  }
  const checking = revalidator.state === 'loading';
  return (
    <RouteStatus
      title="登录状态"
      message={checking ? '正在检查当前会话…' : '暂时无法确认当前会话，请重试。'}
      actionLabel="重新连接"
      checking={checking}
      retry={() => revalidator.revalidate()}
    />
  );
}

export function RoutePending() {
  return <RouteStatus title="登录状态" message="正在检查当前会话…" />;
}
