import type { ReactNode } from 'react';

export default function StatusLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-160 flex-col items-start justify-center gap-6 p-8 font-ui wrap-anywhere text-foreground">
      {children}
    </main>
  );
}
