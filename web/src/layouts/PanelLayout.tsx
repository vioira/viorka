import { Menu, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/arc/button/button';
import {
  type Theme,
  ThemeSwitch,
  type ThemeSwitchVariant,
} from '@/components/arc/theme-switch/theme-switch';
import { UserMenu } from '@/components/arc/user-menu/user-menu';
import Notifications from './Notifications';
import PanelNavigation from './PanelNavigation';

interface PanelLayoutProps {
  panelName?: string;
  defaultTheme?: 'dark' | 'light' | 'system';
  realtime?: boolean;
  children: ReactNode;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  pending: boolean;
  onSignOut: () => Promise<void>;
}

export default function PanelLayout({
  panelName = 'Viorka',
  defaultTheme,
  realtime = false,
  children,
  username,
  role,
  pending,
  onSignOut,
}: PanelLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
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

  useEffect(() => {
    document.title = `${panelName} 控制台`;
  }, [panelName]);

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
    <div className="flex min-h-svh flex-col bg-background bg-(image:--workspace-wash) font-ui text-(length:--text-sm) text-foreground lg:h-svh lg:flex-row lg:overflow-hidden">
      <a
        href="#panel-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-(--radius-control) focus:bg-(--surface) focus:p-4"
      >
        跳到主要内容
      </a>
      <aside
        className="flex shrink-0 flex-col border-b-[0.5px] border-border bg-transparent lg:w-23 lg:border-r-[0.5px] lg:border-b-0"
        aria-label="控制台侧栏"
      >
        <div className="flex h-20 shrink-0 items-center gap-3 px-5 lg:h-23.5 lg:items-start lg:justify-center lg:px-0 lg:pt-6">
          <img src="/image/viorka.svg" alt={panelName} width="40" height="40" />
          <div className="min-w-0 flex-1 lg:hidden">
            <p className="font-medium truncate" title={panelName}>
              {panelName}
            </p>
            <p className="text-(length:--text-xs) text-text-secondary">控制面板</p>
          </div>
          <div className="lg:hidden">
            <Button
              variant="ghost"
              aria-label={menuOpen ? '收起导航' : '展开导航'}
              aria-expanded={menuOpen}
              aria-controls="panel-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? (
                <X size={20} aria-hidden="true" />
              ) : (
                <Menu size={20} aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
        <div
          id="panel-navigation"
          className={`${menuOpen ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:flex`}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && menuOpen) {
              setMenuOpen(false);
              document
                .querySelector<HTMLButtonElement>('[aria-controls="panel-navigation"]')
                ?.focus();
            }
          }}
        >
          <PanelNavigation
            pathname={location.pathname}
            onNavigate={async (path) => {
              await navigate(path);
              setMenuOpen(false);
              document.getElementById('panel-content')?.focus();
            }}
          />
          <div className="mt-auto flex shrink-0 justify-center px-4 pb-5 pt-3" aria-busy={pending}>
            <UserMenu
              user={{
                name: username,
                email: '',
                plan: { admin: '管理员', operator: '操作员', viewer: '只读用户' }[role],
              }}
              align="start"
              showTheme={false}
              onSignOut={onSignOut}
            />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-22 shrink-0 items-center justify-end gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <ThemeSwitch
              theme={dark ? 'dark' : 'light'}
              variant="reveal"
              iconOnly
              label={dark ? '切换到浅色主题' : '切换到深色主题'}
              onThemeChange={toggleTheme}
            />
            <Notifications realtime={realtime} />
          </div>
        </header>
        <main
          id="panel-content"
          tabIndex={-1}
          className="min-w-0 flex-1 space-y-6 p-4 sm:p-6 lg:overflow-y-auto lg:px-6 lg:pt-2 lg:pb-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
