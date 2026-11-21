import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import Pagination from '.';
import { jumpPage, pageItems } from './pages';

function arrow(html: string, label: string) {
  return html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0];
}

it('shows the ends and nearby pages of a long list with bounded jumps', () => {
  expect(pageItems(6, 50)).toEqual([1, 'back', 4, 5, 6, 7, 8, 'forward', 50]);
  expect(pageItems(1, 50)).toEqual([1, 2, 3, 4, 5, 6, 'forward', 50]);
  expect(pageItems(50, 50)).toEqual([1, 'back', 45, 46, 47, 48, 49, 50]);
  expect(pageItems(3, 4)).toEqual([1, 2, 3, 4]);
  expect(jumpPage(6, 50, 'forward')).toBe(11);
  expect(jumpPage(2, 50, 'back')).toBe(1);
  expect(jumpPage(49, 50, 'forward')).toBe(50);
});

it('marks the current cursor page without announcing a total', () => {
  const html = renderToStaticMarkup(
    <Pagination label="任务分页" page={4} hasNext={false} onPageChange={() => {}} />,
  );
  expect(html).toContain('aria-label="任务分页"');
  expect(html).toContain('aria-current="page" aria-label="第 4 页"');
  expect(arrow(html, '上一页')).not.toContain(' disabled=""');
  expect(arrow(html, '下一页')).toContain(' disabled=""');
  expect(html).not.toContain('第 5 页');
  expect(html).not.toContain('共');
});

it.each([
  [1, 3, true, false],
  [2, 3, false, false],
  [3, 3, false, true],
  [1, 1, true, true],
])('uses native arrow availability on page %i of %i', (page, pageCount, previous, next) => {
  const html = renderToStaticMarkup(
    <Pagination label="分类分页" page={page} pageCount={pageCount} onPageChange={() => {}} />,
  );
  expect(arrow(html, '上一页')?.includes(' disabled=""')).toBe(previous);
  expect(arrow(html, '下一页')?.includes(' disabled=""')).toBe(next);
});
