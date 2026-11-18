import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import { RealtimeProvider, useBrowserSocket } from './realtime';

// A different module URL recreates the consumer module, as in a Vite hot update.
const refreshedUrl = './realtime.tsx?refresh=consumer';
const refreshed: typeof import('./realtime') = await import(refreshedUrl);

function Consumer() {
  const originalSocket = useBrowserSocket();
  const refreshedSocket = refreshed.useBrowserSocket();
  expect(refreshedSocket).toBe(originalSocket);
  expect(refreshed.useRealtimeEnabled()).toBe(true);
  return null;
}

it('shares the authenticated socket with consumers loaded after a module refresh', () => {
  expect(refreshed.useBrowserSocket).not.toBe(useBrowserSocket);

  renderToStaticMarkup(
    <ToastStackProvider>
      <RealtimeProvider enabled csrf="test">
        <Consumer />
      </RealtimeProvider>
    </ToastStackProvider>,
  );
});
