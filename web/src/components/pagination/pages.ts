const jumpSize = 5;

export function pageItems(page: number, last: number): (number | 'back' | 'forward')[] {
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1);

  const left = Math.max(2, Math.min(page - 2, last - 5));
  const right = Math.min(last - 1, Math.max(page + 2, 6));
  const firstNeighbor = left === 3 ? 2 : left;
  const lastNeighbor = right === last - 2 ? last - 1 : right;
  return [
    1,
    ...(firstNeighbor > 2 ? (['back'] as const) : []),
    ...Array.from(
      { length: lastNeighbor - firstNeighbor + 1 },
      (_, index) => firstNeighbor + index,
    ),
    ...(lastNeighbor < last - 1 ? (['forward'] as const) : []),
    last,
  ];
}

export function jumpPage(page: number, last: number, direction: 'back' | 'forward') {
  return direction === 'back' ? Math.max(1, page - jumpSize) : Math.min(last, page + jumpSize);
}
