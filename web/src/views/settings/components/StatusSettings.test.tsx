import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@/api/auth';
import type { NodeRecord } from '@/api/nodes';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import StatusNodePicker from './StatusNodePicker';
import StatusPublishedList from './StatusPublishedList';
import StatusSettings from './StatusSettings';

function renderWithSession(role: Session['user']['role']) {
  const session: Session = {
    csrf_token: 'csrf',
    expires_at: '2026-12-01T00:00:00Z',
    user: { id: 'u1', username: 'alice', role },
  };
  return renderToStaticMarkup(
    <ToastStackProvider>
      <MemoryRouter initialEntries={['/settings?tab=public-status']}>
        <Routes>
          <Route element={<Outlet context={session} />}>
            <Route path="/settings" element={<StatusSettings />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastStackProvider>,
  );
}

const sampleNodes: NodeRecord[] = [
  {
    id: 'n1',
    name: '东京-01',
    kind: 'vps',
    state: 'online',
    last_seen_at: '2026-11-25T00:00:00Z',
    os: 'debian',
    arch: 'amd64',
    agent_version: '0.4.2',
    location: { country_code: 'JP', subdivision: '', city: 'Tokyo' },
    categories: [
      { id: 'g1', kind: 'group', name: '亚太节点', shared: true },
      { id: 't1', kind: 'tag', name: 'CN2', shared: true },
    ],
  },
  {
    id: 'n2',
    name: '香港-NAT',
    kind: 'nat',
    state: 'offline',
    last_seen_at: '2026-11-25T00:00:00Z',
    os: 'ubuntu',
    arch: 'amd64',
    agent_version: '0.4.2',
    categories: [{ id: 'g2', kind: 'group', name: '内部分组', shared: false }],
  },
];

describe('StatusSettings views', () => {
  it('blocks non-admin accounts with forbidden empty state', () => {
    const html = renderWithSession('viewer');
    expect(html).toContain('需要管理员权限');
    expect(html).toContain('alice');
    expect(html).not.toContain('发布状态页');
  });

  it('renders loading skeleton on initial admin mount', () => {
    const html = renderWithSession('admin');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('正在读取公开状态页配置');
  });

  it('renders StatusNodePicker with search, filter and public group visibility', () => {
    const html = renderToStaticMarkup(
      <StatusNodePicker
        nodes={sampleNodes}
        selectedIds={new Set(['n1'])}
        disabled={false}
        onToggleNode={vi.fn()}
        onAddNodes={vi.fn()}
      />,
    );
    expect(html).toContain('可选节点');
    expect(html).toContain('已选 1 / 2 台');
    expect(html).toContain('全选');
    expect(html).toContain('公开分组 亚太节点');
    expect(html).toContain('内部分组（未公开）');
  });

  it('renders StatusPublishedList empty state with quick add online action', () => {
    const html = renderToStaticMarkup(
      <StatusPublishedList
        entries={[]}
        nodeMap={new Map(sampleNodes.map((n) => [n.id, n]))}
        savedIds={new Set()}
        onlineCount={1}
        disabled={false}
        onUpdateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onRemoveNode={vi.fn()}
        onAddAllOnline={vi.fn()}
        onSortByAlias={vi.fn()}
        onSortOnlineFirst={vi.fn()}
        onResetAliases={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );
    expect(html).toContain('尚未选择公开节点');
    expect(html).toContain('添加全部在线节点 (1)');
  });

  it('renders StatusPublishedList ordered rows and inline validation errors', () => {
    const html = renderToStaticMarkup(
      <StatusPublishedList
        entries={[
          { id: 'n1', alias: 'Tokyo Edge' },
          { id: 'n2', alias: '   ' },
        ]}
        nodeMap={new Map(sampleNodes.map((n) => [n.id, n]))}
        savedIds={new Set(['n1'])}
        onlineCount={1}
        disabled={false}
        onUpdateNode={vi.fn()}
        onMoveNode={vi.fn()}
        onRemoveNode={vi.fn()}
        onAddAllOnline={vi.fn()}
        onSortByAlias={vi.fn()}
        onSortOnlineFirst={vi.fn()}
        onResetAliases={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );
    expect(html).toContain('2 / 128');
    expect(html).toContain('1 项待修正');
    expect(html).toContain('#1');
    expect(html).toContain('#2');
    expect(html).toContain('新增');
    expect(html).toContain('亚太节点');
    expect(html).toContain('CN2');
    expect(html).toContain('分组“内部分组”未公开');
    expect(html).toContain('请输入公开别名');
  });
});
