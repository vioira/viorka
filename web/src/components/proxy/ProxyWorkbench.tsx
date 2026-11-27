import { ArrowLeft, Save, Undo2 } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker } from 'react-router';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Teleport } from '@/components/teleport';

/** Shared workbench shell for /proxy/* create and edit subpages. */
export default function ProxyWorkbench({
  parentLabel,
  parentPath,
  breadcrumbLabel,
  title,
  subtitle,
  meta,
  form,
  saveLabel,
  saveButtonRef,
  busy,
  disabled,
  dirty,
  backLabel = '返回列表',
  onClose,
  actions,
  children,
}: {
  parentLabel: string;
  parentPath: string;
  breadcrumbLabel: string;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  form: string;
  saveLabel: string;
  saveButtonRef?: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  disabled?: boolean;
  dirty: boolean;
  backLabel?: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previousTrigger = useRef<HTMLElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const blocker = useBlocker(dirty && !busy);

  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <section className="min-w-0 space-y-6" aria-label={title}>
      <Teleport to="#panel-header">
        <span className="inline-flex min-w-0 max-w-full items-center gap-3 text-(length:--text-lg) font-medium">
          <Link to={parentPath} className="shrink-0 text-text-secondary hover:text-foreground">
            {parentLabel}
          </Link>
          <span aria-hidden="true" className="hidden text-text-muted sm:inline">
            /
          </span>
          <span className="hidden truncate text-foreground sm:inline">{breadcrumbLabel}</span>
        </span>
      </Teleport>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b-[1px] border-border-subtle pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="hidden sm:block">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={(event) => {
                previousTrigger.current = event.currentTarget;
                if (dirty) setLeaving(true);
                else onClose();
              }}
            >
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
              {backLabel}
            </Button>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                ref={heading}
                tabIndex={-1}
                className="wrap-anywhere text-(length:--text-base) font-medium outline-none"
              >
                {title}
              </h2>
              {meta}
            </div>
            {subtitle && (
              <p className="mt-1 text-(length:--text-xs) text-text-secondary">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={(event) => {
              previousTrigger.current = event.currentTarget;
              if (dirty) setLeaving(true);
              else onClose();
            }}
          >
            取消
          </Button>
          <Button ref={saveButtonRef} type="submit" form={form} loading={busy} disabled={disabled}>
            <Save size={16} strokeWidth={1.75} aria-hidden="true" />
            {saveLabel}
          </Button>
        </div>
      </header>

      {children}

      <Dialog
        open={leaving || blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open) {
            setLeaving(false);
            if (blocker.state === 'blocked') blocker.reset();
          }
        }}
      >
        <DialogContent
          title="放弃未保存的修改？"
          description="离开后，本次修改不会保存。"
          onCloseAutoFocus={(event) => {
            const target = previousTrigger.current?.isConnected
              ? previousTrigger.current
              : heading.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setLeaving(false);
                  if (blocker.state === 'blocked') blocker.reset();
                }}
              >
                继续编辑
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (blocker.state === 'blocked') blocker.proceed();
                  else onClose();
                }}
              >
                <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
                放弃修改
              </Button>
            </>
          }
        />
      </Dialog>
    </section>
  );
}
