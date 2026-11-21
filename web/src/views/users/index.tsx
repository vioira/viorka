import { useCallback } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { type Account, listUsers } from '@/api/users';
import DataTable, { type DataColumn } from '@/components/data-table';
import EmptyStates from '@/components/empty-states';
import Pagination from '@/components/pagination';
import { cursorListPageSizes, useCursorList } from '@/hooks/use-cursor-list';
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
  const fetchItems = useCallback(
    async (after: string, signal: AbortSignal, limit: number) =>
      (await listUsers(after, signal, limit)).items,
    [],
  );
  const accounts = useCursorList({
    enabled: admin,
    fetchItems,
    defaultPageSize: 50,
    errorMessage: '无法读取用户，请重试。',
  });
  const [, setNotice] = useToastFeedback('success');
  const refreshAfterChange = async () => {
    if (await accounts.refresh()) setNotice('用户列表已更新。');
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
      <div className="flex flex-wrap items-center justify-end gap-4">
        {admin && <InviteUser session={session} onCreated={refreshAfterChange} />}
      </div>
      <section aria-label="用户列表" className="v-card">
        {admin ? (
          <>
            <DataTable
              loaded={accounts.loaded}
              rows={accounts.items}
              columns={columns}
              rowKey="id"
              caption="用户列表"
              loading={accounts.loading}
              error={accounts.error}
              onRetry={accounts.retry}
              minWidth={640}
            />
            {accounts.loaded && (
              <div className="mt-4">
                <Pagination
                  label="用户分页"
                  page={accounts.page}
                  hasNext={accounts.hasNext}
                  busy={accounts.loading}
                  onPageChange={accounts.goToPage}
                  pageSize={{
                    value: accounts.pageSize,
                    options: cursorListPageSizes,
                    onChange: accounts.changePageSize,
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <EmptyStates
            variant="forbidden"
            title="需要管理员权限"
            description={`当前账号 ${session.user.username} 的角色为${roles[session.user.role]}。`}
          />
        )}
      </section>
      <section aria-labelledby="roles-heading" className="v-card">
        <h2 id="roles-heading" className="v-card-title">
          角色权限
        </h2>
        <p className="v-card-description">角色权限作用于当前实例。</p>
        <dl className="mt-4 divide-y-[1px] divide-border">
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
