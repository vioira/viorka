import { expect, it } from 'vitest';
import { cursorForPage, firstCursor, pageWithLookahead } from './cursor-page';

it('uses returned cursors to go forward one page and jump back to a known page', () => {
  const second = cursorForPage(firstCursor, 2, 'c10');
  const third = cursorForPage(second, 3, 'c20');
  expect(third).toEqual({ after: 'c20', history: ['', 'c10'] });
  expect(cursorForPage(third, 2, 'c30')).toEqual(second);
  expect(cursorForPage(third, 1, 'c30')).toEqual(firstCursor);
  expect(cursorForPage(third, 5, 'c30')).toBe(third);
  expect(cursorForPage(third, 4, '')).toBe(third);
});

it('disables forward navigation on an exactly full last page and reuses the lookahead row', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  expect(pageWithLookahead(items, 3)).toEqual({ items, nextCursor: '' });
  expect(pageWithLookahead(items, 2)).toEqual({ items: items.slice(0, 2), nextCursor: 'b' });
  expect(pageWithLookahead([], 2)).toEqual({ items: [], nextCursor: '' });
});
