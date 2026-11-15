import { useNavigate } from 'react-router';
import { Button } from '@/components/arc/button/button';
import EmptyStates from '@/components/empty-states';
import StatusLayout from '@/layouts/StatusLayout';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <StatusLayout>
      <h1 className="sr-only">404 页面不存在</h1>
      <EmptyStates
        variant="not-found"
        title="页面不存在"
        description="请检查地址，或返回总览。"
        action={
          <Button variant="secondary" onClick={() => navigate('/', { replace: true })}>
            返回总览
          </Button>
        }
      />
    </StatusLayout>
  );
}
