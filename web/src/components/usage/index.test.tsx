import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Usage from './index';

describe('Usage', () => {
  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -1])('shows unknown for %s', (value) => {
    const html = renderToStaticMarkup(<Usage value={value} label="CPU" />);
    expect(html).toContain('无数据');
    expect(html).not.toContain('width:');
    expect(html).toContain('CPU');
  });
  it.each([0, 23.5, 100])('preserves the valid percentage %s', (value) => {
    const html = renderToStaticMarkup(<Usage value={value} />);
    expect(html).toContain(`${value}%`);
    expect(html).toContain(`width:${value}%`);
    expect(html).not.toContain('无数据');
  });
  it('bounds the bar while retaining an above-range measurement as text', () => {
    const html = renderToStaticMarkup(<Usage value={125} label="CPU" />);
    expect(html).toContain('125%');
    expect(html).toContain('width:100%');
    expect(html).not.toContain('width:125%');
  });
});
