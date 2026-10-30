import { useRevalidator, useRouteError } from 'react-router';
import { Button } from '@/components/arc/button/button';
import StatusLayout from '@/layouts/StatusLayout';

export function RouteError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  return (
    <StatusLayout>
      <h1 className="m-0 text-(length:--text-xl) font-medium">无法检查登录状态</h1>
      <p className="m-0 text-(length:--text-sm) text-text-secondary" role="alert">
        {error instanceof Error ? error.message : '请稍后重试，或联系实例管理员。'}
      </p>
      <Button
        variant="primary"
        loading={revalidator.state === 'loading'}
        onClick={() => revalidator.revalidate()}
      >
        重新连接
      </Button>
    </StatusLayout>
  );
}

export function RoutePending() {
  return (
    <StatusLayout>
      <p className="m-0 text-(length:--text-sm) text-text-secondary" role="status">
        正在检查登录状态…
      </p>
    </StatusLayout>
  );
}
