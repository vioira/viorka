import { type ReactNode, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function Teleport({ to, children }: { to: string; children: ReactNode }) {
  const [target, setTarget] = useState<Element | null>(null);

  useLayoutEffect(() => {
    setTarget(document.querySelector(to));
  }, [to]);

  return target ? createPortal(children, target) : null;
}
