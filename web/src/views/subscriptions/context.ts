import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import type {
  RecoveryStatus,
  SubscriptionIssued,
  SubscriptionRule,
  SubscriptionTemplate,
} from '@/api/subscriptions';

export interface SubscriptionsContextValue {
  session: Session;
  canManage: boolean;
  isAdmin: boolean;
  rules: SubscriptionRule[] | null;
  rulesLoading: boolean;
  templates: SubscriptionTemplate[] | null;
  templatesLoading: boolean;
  pendingRecoveryCount: number;
  recoveryCountLoaded: boolean;
  reloadRules: () => Promise<void>;
  reloadTemplates: () => Promise<void>;
  reloadRecoverySummary: () => Promise<void>;
  openIssued: (issued: SubscriptionIssued) => void;
}

export function isRecoveryPending(item: RecoveryStatus): boolean {
  if (item.state !== 'matched') return true;
  return item.services.some(
    (service) => service.enabled && service.change !== 'removed' && !service.confirmed,
  );
}

export function useSubscriptionsContext(): SubscriptionsContextValue {
  return useOutletContext<SubscriptionsContextValue>();
}
