import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Theme, ThemeSwitchVariant } from '@/components/arc/theme-switch/theme-switch';

export function useTheme(defaultTheme?: Theme | 'system') {
  const [dark, setDark] = useState(true);
  const transitionRef = useRef<ViewTransition | null>(null);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === 'dark');
    return () => transitionRef.current?.skipTransition();
  }, []);

  useEffect(() => {
    if (!defaultTheme) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = defaultTheme === 'system' ? media.matches : defaultTheme === 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      setDark(dark);
    };
    apply();
    if (defaultTheme === 'system') media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [defaultTheme]);

  function toggleTheme(next: Theme, _variant: ThemeSwitchVariant, trigger: HTMLElement) {
    transitionRef.current?.skipTransition();
    const root = document.documentElement;
    const applyTheme = () => {
      root.dataset.theme = next;
      flushSync(() => setDark(next === 'dark'));
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
