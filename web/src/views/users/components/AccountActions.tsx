import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Session } from '@/api/auth';
import { type Account, changeUserRole, type Role, removeUser } from '@/api/users';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
export default function AccountActions({
  account,
  session,
  onChange,
}: {
  account: Account;
  session: Session;
  onChange: () => Promise<void>;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [role, setRole] = useState<Role>(account.role);
  const [pending, setPending] = useState(false);
  const [, setError] = useToastFeedback('error');
  const navigate = useNavigate();
  async function run(action: () => Promise<void>, changingRole = false) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await action();
      setRemoveOpen(false);
      setRoleOpen(false);
      if (changingRole && account.id === session.user.id) {
        await navigate('/login', { replace: true });
        return;
      }
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成，请重试。');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex gap-1">
      {account.status === 'active' && (
        <Dialog
          open={roleOpen}
          onOpenChange={(open) => {
            setRoleOpen(open);
            setRole(account.role);
            setError('');
          }}
        >
          <DialogTrigger asChild>
            <Button variant="ghost" aria-label={`修改 ${account.username} 的角色`}>
              修改角色
            </Button>
          </DialogTrigger>
          <DialogContent
            title={`修改 ${account.username} 的角色`}
            description="保存后该用户需要重新登录。不能降级最后一个管理员。"
          >
            <div className="space-y-4">
              <SegmentedControl
                label="角色"
                value={role}
                onValueChange={(value) => setRole(value as Role)}
                options={[
                  { value: 'admin', label: '管理员' },
                  { value: 'operator', label: '操作员' },
                  { value: 'viewer', label: '只读' },
                ]}
                className="[--control-height-sm:44px]"
              />
              <div className="flex gap-2">
                <DialogClose asChild>
                  <Button variant="secondary">取消</Button>
                </DialogClose>
                <Button
                  loading={pending}
                  onClick={() => run(() => changeUserRole(session, account.id, role), true)}
                >
                  保存角色
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {account.id === session.user.id ? (
        <span className="self-center whitespace-nowrap text-(length:--text-xs) text-text-secondary">
          当前账号
        </span>
      ) : (
        <Dialog
          open={removeOpen}
          onOpenChange={(open) => {
            setRemoveOpen(open);
            setError('');
          }}
        >
          <DialogTrigger asChild>
            <Button variant="ghost" aria-label={`移除 ${account.username}`}>
              移除
            </Button>
          </DialogTrigger>
          <DialogContent
            title={`移除用户 ${account.username}？`}
            description={
              account.status === 'invited'
                ? '邀请链接将立即失效。'
                : '该用户的会话立即失效，其历史操作仍保留在审计日志中。'
            }
          >
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button variant="secondary">取消</Button>
              </DialogClose>
              <Button
                variant="danger"
                loading={pending}
                onClick={() => run(() => removeUser(session, account.id))}
              >
                移除用户
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
