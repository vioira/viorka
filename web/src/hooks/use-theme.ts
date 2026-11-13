import { useEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type { Theme, ThemeSwitchVariant } from '@/components/arc/theme-switch/theme-switch';

function subscribeTheme(onChange: () => void) {
  window.addEventListener('viorka:theme-change', onChange);
  return () => window.removeEventListener('viorka:theme-change', onChange);
}

function getDarkSnapshot() {
  return document.documentElement.dataset.theme === 'dark';
}

export function useTheme() {
  const dark = useSyncExternalStore(subscribeTheme, getDarkSnapshot, () => false);
  const transitionRef = useRef<ViewTransition | null>(null);

  useEffect(() => () => transitionRef.current?.skipTransition(), []);

  function toggleTheme(next: Theme, _variant: ThemeSwitchVariant, trigger: HTMLElement) {
    transitionRef.current?.skipTransition();
    const root = document.documentElement;
    const applyTheme = () => {
      root.dataset.theme = next;
      root.classList.toggle('dark', next === 'dark');
      try {
        localStorage.setItem('viorka.theme', next);
      } catch {
        // 浏览器禁止存储时，当前页面仍可切换主题。
      }
      flushSync(() => window.dispatchEvent(new Event('viorka:theme-change')));
    };
    if (
      !document.startViewTransition ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      applyTheme();
      return;
    }
    const { left, top, width, height } = trigger.getBoundingClientRect();
    root.style.setProperty('--theme-reveal-x', `${left + width / 2}px`);
    root.style.setProperty('--theme-reveal-y', `${top + height / 2}px`);
    root.dataset.themeTransition = 'reveal';
    const transition = document.startViewTransition(applyTheme);
    transitionRef.current = transition;
    const cleanup = () => {
      if (transitionRef.current !== transition) return;
      transitionRef.current = null;
      delete root.dataset.themeTransition;
      root.style.removeProperty('--theme-reveal-x');
      root.style.removeProperty('--theme-reveal-y');
    };
    void transition.finished.then(cleanup, cleanup);
  }

  return { dark, toggleTheme };
}
