import { useRef } from 'react';

// These dialogs are opened by table actions rather than a persistent DialogTrigger.
export function useDialogFocus(fallback?: () => HTMLElement | null) {
  const previous = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      previous.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const target = previous.current?.isConnected ? previous.current : fallback?.();
      if (target?.isConnected) {
        event.preventDefault();
        target.focus();
      }
    },
  };
}
