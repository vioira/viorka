import { KeyRound, Menu } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useMatches, useNavigate } from 'react-router';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/arc/drawer/drawer';
import { ThemeSwitch } from '@/components/arc/theme-switch/theme-switch';
import { UserMenu } from '@/components/arc/user-menu/user-menu';
import { useTheme } from '@/hooks/use-theme';
import ChangePasswordDialog from './ChangePasswordDialog';
import Notifications from './Notifications';
import PanelNavigation, { getActiveMenu, MobileNavigation } from './PanelNavigation';

interface PanelLayoutProps {
  session: import('@/api/auth').Session;
  panelName?: string;
  realtime?: boolean;
  children: ReactNode;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  pending: boolean;
  onSignOut: () => Promise<void>;
}

export default function PanelLayout({
  session,
  panelName = 'Viorka',
  realtime = false,
  children,
  username,
  role,
  pending,
  onSignOut,
}: PanelLayoutProps) {
  const [mobileMenuContainer, setMobileMenuContainer] = useState<HTMLDivElement | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const mobileAvatarRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const navigated = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const activeMenu = getActiveMenu(location.pathname);
  const menuTitle = activeMenu?.label ?? '控制台';
  const isSubpage = useMatches().some(
    (match) => (match.handle as { headerBreadcrumb?: boolean } | undefined)?.headerBreadcrumb,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const { dark, toggleTheme } = useTheme();

  useEffect(() => {
    document.title = `${panelName} 控制台`;
  }, [panelName]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  // Close the overlay for browser history navigation as well as menu selections.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the location key is the navigation event.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.key]);

  return (
    <div className="relative flex min-h-svh flex-col bg-background bg-(image:--workspace-wash) font-ui text-(length:--text-sm) text-foreground lg:h-svh lg:flex-row lg:overflow-hidden">
      <a
        href="#panel-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-(--radius-control) focus:bg-(--surface) focus:p-4"
      >
        跳到主要内容
      </a>
      <aside
        className="flex shrink-0 flex-col border-b-[1px] border-border bg-transparent lg:w-23 lg:border-r-[1px] lg:border-b-0"
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
          <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
            <DrawerTrigger asChild>
              <Button
                ref={menuTriggerRef}
                variant="ghost"
                className="lg:hidden!"
                aria-label="展开导航"
              >
                <Menu size={20} aria-hidden="true" />
              </Button>
            </DrawerTrigger>
            <DrawerContent
              title={panelName}
              side="left"
              aria-describedby={undefined}
              className="mobile-navigation w-[min(20rem,calc(100%-3rem))]! pt-[env(safe-area-inset-top)]"
              footer={
                <div
                  ref={setMobileMenuContainer}
                  className="flex justify-center pb-[env(safe-area-inset-bottom)]"
                  aria-busy={pending}
                >
                  <UserMenu
                    ref={mobileAvatarRef}
                    portalContainer={mobileMenuContainer}
                    items={[
                      {
                        label: '修改密码',
                        icon: <KeyRound size={16} aria-hidden="true" />,
                        onSelect: () => setPasswordOpen(true),
                      },
                    ]}
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
              }
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (navigated.current || window.matchMedia('(min-width: 1024px)').matches) {
                  document.getElementById('panel-content')?.focus();
                  navigated.current = false;
                } else menuTriggerRef.current?.focus();
              }}
            >
              <MobileNavigation
                pathname={location.pathname}
                onNavigate={async (path) => {
                  navigated.current = true;
                  setMenuOpen(false);
                  await navigate(path);
                }}
              />
            </DrawerContent>
          </Drawer>
        </div>
        <div className="hidden min-h-0 flex-1 flex-col lg:flex">
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
              ref={avatarRef}
              items={[
                {
                  label: '修改密码',
                  icon: <KeyRound size={16} aria-hidden="true" />,
                  onSelect: () => setPasswordOpen(true),
                },
              ]}
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
      <ChangePasswordDialog
        session={session}
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        returnFocus={menuOpen ? mobileAvatarRef : avatarRef}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex py-3 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="shrink-0 text-(length:--text-lg) font-medium">
              {isSubpage && activeMenu ? (
                <Link
                  to={activeMenu.path}
                  className="inline-flex items-center text-text-secondary hover:text-foreground"
                >
                  {menuTitle}
                </Link>
              ) : (
                menuTitle
              )}
            </h1>
            {isSubpage && (
              <span aria-hidden="true" className="text-text-muted">
                /
              </span>
            )}
            <div id="panel-header" className="min-w-0 max-w-full empty:hidden" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeSwitch
              theme={dark ? 'dark' : 'light'}
              variant="reveal"
              iconOnly
              label={dark ? '切换到浅色主题' : '切换到深色主题'}
              onThemeChange={toggleTheme}
            />
            <Notifications key={session.user.id} session={session} realtime={realtime} />
          </div>
        </header>
        <main
          id="panel-content"
          tabIndex={-1}
          className="relative min-h-0 min-w-0 flex-1 space-y-6 p-4 sm:p-6 lg:overflow-y-auto lg:px-6 lg:pt-2 lg:pb-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
