import {
  LayoutGrid,
  ListTodo,
  Network,
  Rss,
  Server,
  Settings,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import { motion, useMotionTemplate, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/arc/button/button';
import { motionTokens } from '@/components/arc/lib/motion-tokens';
import { Tooltip } from '@/components/arc/tooltip/tooltip';

const groups = [
  {
    label: '主要',
    items: [
      { label: '总览', icon: LayoutGrid, path: '/' },
      { label: '节点', icon: Server, path: '/nodes' },
      { label: '代理服务', icon: Waypoints, path: '/proxy-services' },
      { label: '拓扑与中转', icon: Network, path: '/topology' },
      { label: '订阅', icon: Rss, path: '/subscriptions' },
    ],
  },
  {
    label: '运维',
    items: [
      { label: '任务中心', icon: ListTodo, path: '/tasks' },
      { label: '审计日志', icon: ShieldCheck, path: '/audit-logs' },
      { label: '系统设置', icon: Settings, path: '/settings' },
    ],
  },
];

interface PanelNavigationProps {
  pathname: string;
  onNavigate: (path: string) => Promise<void>;
}

export default function PanelNavigation({ pathname, onNavigate }: PanelNavigationProps) {
  const container = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const initialized = useRef(false);
  const reduced = useReducedMotion();
  const y = useSpring(0, motionTokens.spring.responsive);
  const [box, setBox] = useState({
    x: 0,
    width: 0,
    height: 0,
    containerWidth: 0,
    containerHeight: 0,
  });
  const bottom = useTransform(() => box.containerHeight - y.get() - box.height);
  const clipPath = useMotionTemplate`inset(${y}px ${box.containerWidth - box.x - box.width}px ${bottom}px ${box.x}px round 999px)`;

  useLayoutEffect(() => {
    const root = container.current;
    const button = buttons.current.get(pathname);
    if (!root || !button) return;
    const measure = (animate: boolean) => {
      const bounds = root.getBoundingClientRect();
      const target = button.getBoundingClientRect();
      if (!bounds.width || !target.height) return;
      const nextY = target.top - bounds.top;
      setBox({
        x: target.left - bounds.left,
        width: target.width,
        height: target.height,
        containerWidth: bounds.width,
        containerHeight: bounds.height,
      });
      if (!initialized.current || reduced || !animate) y.jump(nextY);
      else y.set(nextY);
      initialized.current = true;
    };
    measure(true);
    // Keep the mask and background aligned when the mobile menu opens or the viewport changes.
    let firstResize = true;
    const observer = new ResizeObserver(() => {
      if (firstResize) {
        firstResize = false;
        return;
      }
      measure(false);
    });
    observer.observe(root);
    observer.observe(button);
    return () => observer.disconnect();
  }, [pathname, reduced, y]);

  const renderGroups = (overlay: boolean) =>
    groups.map((group) => (
      <div key={group.label}>
        <p className="lg:sr-only px-3 pb-2 text-(length:--text-xs) text-text-secondary">
          {group.label}
        </p>
        <ul className="space-y-1 lg:flex lg:flex-col lg:items-center">
          {group.items.map((item) => {
            const content = (
              <span className="flex w-44 items-center gap-3 text-left lg:w-auto">
                <item.icon size={21} strokeWidth={1.8} aria-hidden="true" />
                <span className="lg:sr-only">{item.label}</span>
              </span>
            );
            return (
              <li key={item.path} className="flex lg:justify-center">
                {overlay ? (
                  <div className="flex h-13 w-full items-center justify-center px-4 font-medium text-(--brand-ink) lg:size-13 lg:p-0">
                    {content}
                  </div>
                ) : (
                  <Tooltip content={item.label} side="right">
                    <Button
                      ref={(node) => {
                        if (node) buttons.current.set(item.path, node);
                        else buttons.current.delete(item.path);
                      }}
                      variant={pathname === item.path ? 'primary' : 'ghost'}
                      className="h-13 w-full border-0! rounded-full! [--text-secondary:var(--navigation-foreground)] [--foreground:var(--navigation-foreground)] [--surface-muted:var(--navigation-hover)] [--button-primary-foreground:var(--navigation-foreground)] [--button-primary-background:transparent] [--button-primary-shadow:none] hover:filter-none! active:opacity-100! lg:size-13 lg:p-0!"
                      aria-label={item.label}
                      aria-current={pathname === item.path ? 'page' : undefined}
                      onClick={() => onNavigate(item.path)}
                    >
                      {content}
                    </Button>
                  </Tooltip>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    ));

  return (
    <nav aria-label="主导航" className="flex-1 overflow-y-auto px-3 pb-6 lg:-mt-4 lg:pt-4">
      <div ref={container} className="relative isolate">
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 rounded-full bg-(image:--brand-gradient) shadow-(--navigation-active-shadow)"
          style={{ x: box.x, y, width: box.width, height: box.height }}
        />
        <div className="relative space-y-4 lg:space-y-1">{renderGroups(false)}</div>
        {/* The dark copy is clipped by the very same position as the moving background.
            No route-driven color switch or animation-completion timer is involved. */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 space-y-4 lg:space-y-1"
          style={{ clipPath, visibility: box.width ? 'visible' : 'hidden' }}
        >
          {renderGroups(true)}
        </motion.div>
      </div>
    </nav>
  );
}
