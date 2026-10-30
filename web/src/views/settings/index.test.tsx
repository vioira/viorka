import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import SettingsPage from './index';

vi.mock('./components/GeneralSettings', () => ({ default: () => <p>通用面板内容</p> }));
vi.mock('./components/SecuritySettings', () => ({ default: () => <p>安全面板内容</p> }));

describe('settings deep links', () => {
  it.each([
    ['/settings?tab=tokens', '通用面板内容'],
    ['/settings?tab=security', '安全面板内容'],
    ['/settings', '通用面板内容'],
    ['/settings?tab=invalid', '通用面板内容'],
  ])('opens the requested panel for %s', (url, content) => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[url]}>
        <SettingsPage />
      </MemoryRouter>,
    );
    expect(html).toContain(content);
    for (const other of ['通用面板内容', '令牌面板内容', '安全面板内容']) {
      if (other !== content) expect(html).not.toContain(other);
    }
  });
});
