import { ArrowLeft, Save, Undo2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Teleport } from '@/components/teleport';
import { useDialogFocus } from './useDialogFocus';

/** Shared subpage editor shell with breadcrumb header, dirty guard, and focus management. */
export default function EditorWorkspace({
  breadcrumb,
  title,
  subtitle,
  meta,
  form,
  saveLabel,
  busy,
  disabled,
  dirty,
  backLabel = '返回列表',
  onClose,
  children,
  actions,
}: {
  breadcrumb?: string;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  form: string;
  saveLabel: string;
  busy: boolean;
  disabled?: boolean;
  dirty: boolean;
  backLabel?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const dialogFocus = useDialogFocus(() => heading.current);
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
      {breadcrumb && (
        <Teleport to="#panel-header">
          <span className="truncate text-(length:--text-lg) font-medium text-foreground">
            {breadcrumb}
          </span>
        </Teleport>
      )}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-[1px] border-border-subtle pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => (dirty ? setLeaving(true) : onClose())}
          >
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            {backLabel}
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                ref={heading}
                tabIndex={-1}
                className="break-words text-(length:--text-base) font-medium outline-none"
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
        <div className="flex flex-wrap items-center gap-3">
          {actions}
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => (dirty ? setLeaving(true) : onClose())}
          >
            取消
          </Button>
          <Button type="submit" form={form} loading={busy} disabled={disabled}>
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
          {...dialogFocus}
          data-subscription-management
          title="放弃未保存的修改？"
          description="离开后，本次修改不会保存。"
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
