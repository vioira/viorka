import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { TabsList } from '@/components/arc/tabs/tabs';

export function PageTabsList(props: ComponentProps<typeof TabsList>) {
  const tabsAnchor = useRef<HTMLDivElement>(null);
  const [tabsStuck, setTabsStuck] = useState(false);

  useEffect(() => {
    const anchor = tabsAnchor.current;
    const scrollContainer = document.getElementById('panel-content');
    if (!anchor || !scrollContainer) return;
    const update = () => {
      const contained = getComputedStyle(scrollContainer).overflowY === 'auto';
      const top = contained ? scrollContainer.getBoundingClientRect().top : 0;
      setTabsStuck(
        (!contained || scrollContainer.scrollTop > 0) &&
          anchor.getBoundingClientRect().top < top + 8,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(scrollContainer);
    update();
    document.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <>
      <div ref={tabsAnchor} aria-hidden="true" />
      <div
        className={`sticky top-[8px] isolate z-20 w-fit max-w-full rounded-(--radius-surface) px-1 [--tabs-trigger-height:48px] [--tabs-trigger-padding:20px] [--tabs-font-size:var(--text-base)] [--tabs-indicator-inset:auto_calc(50%-12px)_5px] [--tabs-indicator-height:3px] [--tabs-indicator-radius:var(--radius-control)] ${tabsStuck ? 'backdrop-blur-2xl' : ''}`}
      >
        {tabsStuck && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-background bg-(image:--workspace-wash) opacity-40"
          />
        )}
        <TabsList {...props} borderless />
      </div>
    </>
  );
}
