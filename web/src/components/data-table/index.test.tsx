import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import DataTable, { type DataTableProps } from './index';

type Row = { id: string; name: string };
function render(props: Partial<DataTableProps<Row>> = {}) {
  return renderToStaticMarkup(
    <ToastStackProvider>
      <DataTable<Row>
        rows={[]}
        columns={[{ key: 'name', label: '名称' }]}
        rowKey="id"
        caption="节点"
        {...props}
      />
    </ToastStackProvider>,
  );
}

describe('table data availability', () => {
  it('illustrates a confirmed empty collection', () => {
    expect(render()).toContain('/image/states/light/empty.svg');
  });
  it('keeps unread and failed data unknown instead of claiming emptiness', () => {
    for (const props of [{ loaded: false }, { error: '读取失败' }]) {
      const html = render(props);
      expect(html).toContain('节点尚未读取');
      expect(html).not.toContain('/image/states/');
      expect(html).not.toContain('暂无数据');
    }
  });
  it('uses skeletons during first load rather than an empty illustration', () => {
    const html = render({ loading: true, loaded: false });
    expect(html).toContain('正在加载节点');
    expect(html).not.toContain('/image/states/');
  });
  it('retains confirmed empty results during refresh and after a refresh failure', () => {
    for (const props of [{ loading: true }, { error: '读取失败' }]) {
      const html = render({ loaded: true, ...props });
      expect(html).toContain('/image/states/light/empty.svg');
      expect(html).not.toContain('正在加载节点');
    }
  });
  it('retains existing rows during refresh and failures', () => {
    for (const props of [{ loading: true }, { error: '读取失败' }]) {
      const html = render({ rows: [{ id: 'node-1', name: '已有节点' }], ...props });
      expect(html).toContain('已有节点');
      expect(html).not.toContain('/image/states/');
    }
  });
  it('shows a distinct no-results scene and a caller supplied action', () => {
    const html = render({
      emptyMessage: '没有匹配的节点',
      emptyState: { variant: 'no-results', action: <a href="/nodes">查看全部节点</a> },
    });
    expect(html).toContain('/no-results.svg');
    expect(html).toContain('查看全部节点');
  });
});
