import { createContext } from 'react';
import type { BrowserSocket, ChangeSubscription } from '@/api/browser-socket';
import type { ResourceChange } from '@/api/realtime';

// Keep context identity independent of hot updates to the provider and its consumers.
export type ServerEvent =
  | { type: 'ready' | 'disconnected' }
  | { type: 'change'; change: ResourceChange }
  | { type: 'snapshot' | 'notifications'; data: string };
export const SocketContext = createContext<BrowserSocket | null>(null);
export type Listener = (event: ServerEvent) => void;
export const RealtimeContext = createContext({
  enabled: false,
  initialized: false,
  generation: 0,
  connected: false,
  subscribe:
    (_listener: Listener, _changes: readonly ChangeSubscription[]): (() => void) =>
    () => {},
});
