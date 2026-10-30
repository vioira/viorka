import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { type Account, listUsers } from '@/api/users';
import { Button } from '@/components/arc/button/button';
import DataTable, { type DataColumn } from '@/components/data-table';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import AccountActions from './components/AccountActions';
import InviteUser from './components/InviteUser';

const roles = { admin: '管理员', operator: '操作员', viewer: '只读' };
const permissions = [
  ['管理员 admin', '管理用户、角色、注册令牌、系统设置与备份，执行节点检查。'],
  ['操作员 operator', '查看节点、任务与通知，执行节点检查。'],
  ['只读 viewer', '查看节点、任务与通知，不能执行节点操作。'],
];
export default function UsersPage() {
  const session = useOutletContext<Session>();
  const admin = session.user.role === 'admin';
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [after, setAfter] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [, setNotice] = useToastFeedback('success');
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAccounts((await listUsers(after)).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取用户，请重试。');
    } finally {
      setLoading(false);
    }
  }, [after]);
  useEffect(() => {
    if (!admin) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    listUsers(after, controller.signal)
      .then((value) => setAccounts(value.items))
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '无法读取用户，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [admin, after]);
  const refreshAfterChange = async () => {
    await reload();
    setNotice('用户列表已更新。');
  };
  const columns: DataColumn<Account>[] = [
    {
      key: 'username',
      label: '用户',
      render: (_, row) => <span className="break-all font-medium">{row.username}</span>,
    },
    {
      key: 'email',
      label: '邮箱',
      render: (_, row) => (
        <span className="break-all text-text-secondary">{row.email || '未设置'}</span>
      ),
    },
    { key: 'role', label: '角色', render: (_, row) => roles[row.role] },
    {
      key: 'status',
      label: '状态',
      render: (_, row) =>
        row.status === 'invited'
          ? '邀请待接受'
          : row.id === session.user.id
            ? '当前会话'
            : '已启用',
    },
    {
      key: 'actions',
      label: '操作',
      sortable: false,
      render: (_, row) => (
        <AccountActions account={row} session={session} onChange={refreshAfterChange} />
      ),
    },
  ];
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-title text-(length:--text-2xl) font-medium">用户与角色</h1>
          <p className="mt-2 text-text-secondary">管理面板用户与访问权限。</p>
        </div>
        {admin && <InviteUser session={session} onCreated={refreshAfterChange} />}
      </div>
      <section
        aria-labelledby="users-heading"
        className="min-w-0 rounded-(--radius-surface) border-[0.5px] border-border bg-(--surface) p-5 sm:p-6"
      >
        <h2 id="users-heading" className="mb-5 font-medium">
          用户
        </h2>
        {admin ? (
          <>
            <DataTable
              rows={accounts}
              columns={columns}
              rowKey="id"
              caption="用户列表"
              loading={loading}
              error={error}
              onRetry={reload}
              tableClassName="min-w-160"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={loading || history.length === 0}
                onClick={() => {
                  setAfter(history[history.length - 1]);
                  setHistory(history.slice(0, -1));
                }}
              >
                上一页
              </Button>
              <Button
                variant="secondary"
                disabled={loading || accounts.length < 50}
                onClick={() => {
                  setHistory([...history, after]);
                  setAfter(accounts[accounts.length - 1].id);
                }}
              >
                下一页
              </Button>
            </div>
          </>
        ) : (
          <p className="text-text-secondary">
            仅管理员可管理用户。当前账号：{session.user.username}，角色：{roles[session.user.role]}
            。
          </p>
        )}
      </section>
      <section
        aria-labelledby="roles-heading"
        className="rounded-(--radius-surface) border-[0.5px] border-border bg-(--surface) p-5 sm:p-6"
      >
        <h2 id="roles-heading" className="font-medium">
          角色权限
        </h2>
        <p className="mt-2 text-(length:--text-xs) text-text-secondary">角色权限作用于当前实例。</p>
        <dl className="mt-4 divide-y-[0.5px] divide-border">
          {permissions.map(([role, description]) => (
            <div key={role} className="grid gap-2 py-5 sm:grid-cols-[12rem_1fr]">
              <dt className="font-medium">{role}</dt>
              <dd className="text-text-secondary">{description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
