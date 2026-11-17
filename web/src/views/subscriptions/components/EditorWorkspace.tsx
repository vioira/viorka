import { ArrowLeft, Save, Undo2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { useDialogFocus } from './useDialogFocus';

/** Shared full-page editor: preserve drafts on navigation and return focus to the list. */
export default function EditorWorkspace({
  title,
  subtitle,
  form,
  saveLabel,
  busy,
  disabled,
  dirty,
  onClose,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  form: string;
  saveLabel: string;
  busy: boolean;
  disabled?: boolean;
  dirty: boolean;
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
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-(--border-subtle) pb-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            aria-label="返回列表"
            onClick={() => (dirty ? setLeaving(true) : onClose())}
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <h2
              ref={heading}
              tabIndex={-1}
              className="break-words text-lg font-medium outline-none"
            >
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-sm text-(--text-secondary)">{subtitle}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {actions}
          <Button type="submit" form={form} loading={busy} disabled={disabled}>
            <Save size={16} aria-hidden="true" />
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
                <Undo2 size={16} aria-hidden="true" />
                放弃修改
              </Button>
            </>
          }
        />
      </Dialog>
    </section>
  );
}
