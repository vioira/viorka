import { Copy } from 'lucide-react';
import type { Enrollment } from '@/api/enrollment';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function EnrollmentToken({ enrollment }: { enrollment: Enrollment }) {
  const [, setError] = useToastFeedback('error');
  const [, setNotice] = useToastFeedback('success');
  return (
    <>
      <div className="space-y-2">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label="注册令牌"
              readOnly
              value={enrollment.token}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
          <Button
            variant="secondary"
            className="min-h-11 min-w-11 shrink-0"
            aria-label="复制注册令牌"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(enrollment.token);
                setNotice('注册令牌已复制。');
              } catch {
                setError('无法访问剪贴板，请选中令牌后手动复制。');
              }
            }}
          >
            <Copy size={16} aria-hidden="true" />
          </Button>
        </div>
        <p className="text-(length:--text-xs) text-text-secondary">
          明文仅在此弹框中显示，关闭或到期后清除，可重新生成。
        </p>
      </div>
      <p className="text-(length:--text-xs) text-text-secondary">
        到期时间：
        <time className="tabular-nums" dateTime={enrollment.expires_at}>
          {new Date(enrollment.expires_at).toLocaleString('zh-CN')}
        </time>
      </p>
    </>
  );
}
