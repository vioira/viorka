import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Category } from '@/api/public-status';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import NodeSummaryTable from '@/components/node-summary-table';
import type { ListedNode } from '@/hooks/use-nodes';
import NodeFilterBar from './components/NodeFilterBar';
import NodeGroupedList from './components/NodeGroupedList';
import { countNodeFacets, defaultNodeFilters } from './node-filters';

const groupA: Category = { id: 'grp-a', kind: 'group', name: '日本生产', shared: true };
const tag1: Category = { id: 'tag-1', kind: 'tag', name: 'CN2', shared: true };
const tag2: Category = { id: 'tag-2', kind: 'tag', name: 'BGP', shared: false };
const tag3: Category = { id: 'tag-3', kind: 'tag', name: '原生IP', shared: false };

describe('nodes refactored views', () => {
  it('renders dedicated group/tag column with overflow indicator and selection checkboxes', () => {
    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <MemoryRouter>
          <NodeSummaryTable
            showAll
            selectable
            selectedKeys={['n1']}
            onSelectionChange={vi.fn()}
            onRowClick={vi.fn()}
            onFilterByGroup={vi.fn()}
            onFilterByTag={vi.fn()}
            renderCategoryEditor={() => <button type="button">行内编辑</button>}
            nodes={[
              {
                id: 'n1',
                name: '东京-01',
                group: groupA,
                tags: [tag1, tag2, tag3],
                region: '日本',
                os: 'Debian 13',
                kind: '公网 VPS',
                state: 'online',
                uptime: '1 天',
                cost: '50 CNY / 月',
                expiry: '2026-12-30',
                expiryDate: '2026-12-30',
                cpu: 20,
                memory: 40,
                traffic: 5,
                trafficUploadLabel: '2.0 GB',
                trafficDownloadLabel: '3.0 GB',
              },
            ]}
          />
        </MemoryRouter>
      </ToastStackProvider>,
    );
    expect(html).toContain('分组与标签');
    expect(html).toContain('日本生产');
    expect(html).toContain('CN2');
    expect(html).toContain('BGP');
    expect(html).toContain('+1');
    expect(html).toContain('行内编辑');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('data-clickable="true"');
    expect(html).toContain('data-select-cell=""');
  });

  it('renders active filter chips and matched count in NodeFilterBar', () => {
    const categories = [groupA, tag1, tag2];
    const counts = countNodeFacets([], categories, Date.parse('2026-11-25T00:00:00Z'));
    const html = renderToStaticMarkup(
      <NodeFilterBar
        filters={{
          ...defaultNodeFilters,
          query: 'tokyo',
          states: ['online'],
          group: 'grp-a',
          tags: ['tag-1', 'tag-2'],
          tagMode: 'all',
        }}
        counts={counts}
        categories={categories}
        matchedCount={2}
        totalCount={10}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain('搜索：tokyo');
    expect(html).toContain('状态：在线');
    expect(html).toContain('分组：日本生产');
    expect(html).toContain('标签（全部匹配）：CN2、BGP');
    expect(html).toContain('显示 2 / 10 台节点');
    expect(html).toContain('清除全部');
  });

  it('renders collapsible group sections in NodeGroupedList', () => {
    const nodes: ListedNode[] = [
      {
        id: 'n1',
        name: '东京-01',
        kind: 'vps',
        state: 'online',
        last_seen_at: '',
        os: 'debian',
        arch: 'amd64',
        agent_version: '0.4.2',
        categories: [groupA, tag1],
      },
      {
        id: 'n2',
        name: '未分组测试',
        kind: 'nat',
        state: 'offline',
        last_seen_at: '',
        os: 'alpine',
        arch: 'amd64',
        agent_version: '0.4.2',
        categories: [],
      },
    ];
    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <MemoryRouter>
          <NodeGroupedList
            nodes={nodes}
            categories={[groupA, tag1]}
            loaded
            loading={false}
            selectable
            selectedKeys={[]}
            onSelectionChange={vi.fn()}
            onFilterByGroup={vi.fn()}
            onFilterByTag={vi.fn()}
          />
        </MemoryRouter>
      </ToastStackProvider>,
    );
    expect(html).toContain('日本生产');
    expect(html).toContain('公开');
    expect(html).toContain('在线 1 / 1');
    expect(html).toContain('未分组');
    expect(html).toContain('在线 0 / 1');
  });
});
