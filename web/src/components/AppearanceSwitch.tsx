import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  type Theme,
  ThemeSwitch,
  type ThemeSwitchVariant,
} from '@/components/arc/theme-switch/theme-switch';

export default function AppearanceSwitch() {
  const [dark, setDark] = useState(true);
  const transitionRef = useRef<ViewTransition | null>(null);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === 'dark');
    return () => transitionRef.current?.skipTransition();
  }, []);

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

  return (
    <ThemeSwitch
      iconOnly
      theme={dark ? 'dark' : 'light'}
      variant="reveal"
      label={dark ? '切换到浅色主题' : '切换到深色主题'}
      onThemeChange={toggleTheme}
    />
  );
}
