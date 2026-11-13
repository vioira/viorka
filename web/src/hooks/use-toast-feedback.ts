import { useCallback, useId, useState } from 'react';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

/** Retain request status for disabled/unknown states; messages only occupy the global stack. */
export function useToastFeedback(type: 'error' | 'success', notificationId?: string) {
  const [message, setMessage] = useState('');
  const generatedId = useId();
  const id = notificationId ?? generatedId;
  const { toast, dismiss } = useToastStack();
  const report = useCallback(
    (next: string) => {
      setMessage(next);
      // Successful operations are distinct events. Only errors share a deduplication ID.
      if (next) toast({ id: type === 'error' ? id : undefined, type, title: next });
      else if (type === 'error') dismiss(id);
    },
    [id, type, toast, dismiss],
  );
  return [message, report] as const;
}
