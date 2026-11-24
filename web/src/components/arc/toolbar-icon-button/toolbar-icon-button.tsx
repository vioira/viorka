import type { ComponentPropsWithRef } from 'react';

export function ToolbarIconButton({ className = '', ...props }: ComponentPropsWithRef<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className={`relative inline-grid size-(--control-height-md) shrink-0 place-items-center rounded-[12px] border border-border bg-(--button-secondary-background) p-0 text-foreground transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:border-(--border-strong) hover:bg-(--surface-muted) active:border-(--accent) active:bg-(--accent-subtle) data-[state=open]:border-(--border-strong) data-[state=open]:bg-(--surface-muted) motion-reduce:transition-none ${className}`}
    />
  );
}
