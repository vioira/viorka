import {
  Bell,
  ChevronRight,
  LayoutGrid,
  ListTodo,
  LogOut,
  Menu,
  Network,
  Rss,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Waypoints,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/arc/button/button';
import {
  type Theme,
  ThemeSwitch,
  type ThemeSwitchVariant,
} from '@/components/arc/theme-switch/theme-switch';

const groups = [
  {
    label: '主要',
    items: [
      { label: '总览', icon: LayoutGrid, active: true },
      { label: '节点', icon: Server },
      { label: '代理服务', icon: Waypoints },
      { label: '拓扑与中转', icon: Network },
      { label: '订阅', icon: Rss },
    ],
  },
  {
    label: '运维',
    items: [
      { label: '任务中心', icon: ListTodo },
      { label: '审计日志', icon: ShieldCheck },
      { label: '系统设置', icon: Settings },
    ],
  },
];

interface PanelLayoutProps {
  children: ReactNode;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  pending: boolean;
  error: string;
  onSignOut: () => Promise<void>;
}

export default function PanelLayout({
  children,
  username,
  role,
  pending,
  error,
  onSignOut,
}: PanelLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(false);
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
    <div className="flex min-h-svh flex-col bg-background font-ui text-(length:--text-sm) text-foreground lg:h-svh lg:flex-row lg:overflow-hidden">
      <a
        href="#panel-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-(--radius-control) focus:bg-(--surface) focus:p-4"
      >
        跳到主要内容
      </a>
      <aside
        className="flex shrink-0 flex-col border-b-[0.5px] border-border bg-surface-muted lg:w-60 lg:border-r-[0.5px] lg:border-b-0"
        aria-label="控制台侧栏"
      >
        <div className="flex h-20 shrink-0 items-center gap-3 px-5">
          <span
            className="grid size-8 place-items-center rounded-(--radius-control) bg-foreground font-title text-background"
            aria-hidden="true"
          >
            V
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Viorka</p>
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
          <nav aria-label="主导航" className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-3 pb-2 text-(length:--text-xs) text-text-secondary">
                  {group.label}
                </p>
                <ul className="space-y-1">
                  {group.items.map((item) => {
                    const active = 'active' in item && item.active;
                    return (
                      <li key={item.label}>
                        <Button
                          variant={active ? 'primary' : 'ghost'}
                          className={
                            active
                              ? 'w-full [--foreground:var(--accent)] [--background:var(--accent-foreground)]'
                              : 'w-full'
                          }
                          aria-current={active ? 'page' : undefined}
                          disabled={!active}
                          aria-describedby={!active ? 'navigation-note' : undefined}
                          onClick={
                            active
                              ? () => {
                                  setMenuOpen(false);
                                  document.getElementById('panel-content')?.focus();
                                }
                              : undefined
                          }
                        >
                          <span className="flex w-44 items-center gap-3 text-left">
                            <item.icon size={16} strokeWidth={1.75} aria-hidden="true" />
                            {item.label}
                          </span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <p
              id="navigation-note"
              className="px-3 text-(length:--text-xs) leading-5 text-text-secondary"
            >
              其余页面尚未开放
            </p>
          </nav>
          <div className="space-y-3 border-t-[0.5px] border-border p-4">
            <div className="min-w-0 px-2">
              <p className="truncate font-medium" title={username}>
                {username}
              </p>
              <p className="text-(length:--text-xs) text-text-secondary">
                {{ admin: '管理员', operator: '操作员', viewer: '只读用户' }[role]}
              </p>
            </div>
            <Button variant="ghost" className="w-full" loading={pending} onClick={onSignOut}>
              <LogOut size={16} aria-hidden="true" />
              退出登录
            </Button>
            {error && (
              <p role="alert" className="wrap-anywhere text-(length:--text-xs) text-danger">
                {error}
              </p>
            )}
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b-[0.5px] border-border bg-(--surface) px-4 lg:px-6">
          <p className="flex items-center gap-2 text-text-secondary">
            <span className="hidden sm:inline">Viorka</span>
            <ChevronRight className="hidden sm:block" size={14} aria-hidden="true" />
            <span className="text-foreground">总览</span>
          </p>
          <div className="flex items-center gap-2">
            <div className="hidden xl:block">
              <Button variant="secondary" disabled title="全局搜索尚未开放">
                <Search size={16} aria-hidden="true" />
                搜索节点、服务或任务（未开放）
              </Button>
            </div>
            <ThemeSwitch
              theme={dark ? 'dark' : 'light'}
              variant="reveal"
              iconOnly
              label={dark ? '切换到浅色主题' : '切换到深色主题'}
              onThemeChange={toggleTheme}
            />
            <Button variant="ghost" disabled aria-label="通知尚未开放" title="通知尚未开放">
              <Bell size={18} aria-hidden="true" />
            </Button>
          </div>
        </header>
        <main
          id="panel-content"
          tabIndex={-1}
          className="min-w-0 flex-1 space-y-6 p-4 sm:p-6 lg:overflow-y-auto lg:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
