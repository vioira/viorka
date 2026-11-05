import { createBrowserRouter, Navigate } from 'react-router';
import AuthenticatedLayout from '@/layouts/AuthenticatedLayout';
import AcceptInvitationPage from '@/views/accept-invitation';
import AuditLogsPage from '@/views/audit-logs';
import HomePage from '@/views/home';
import LoginPage from '@/views/login';
import NodeDetailsPage from '@/views/node-details';
import NodesPage from '@/views/nodes';
import OutboundConfigsPage from '@/views/outbound-configs';
import NewProtocolPresetPage from '@/views/protocol-preset-new';
import ProtocolPresetsPage from '@/views/protocol-presets';
import ProxyServicesPage from '@/views/proxy-services';
import SettingsPage from '@/views/settings';
import SubscriptionsPage from '@/views/subscriptions';
import TasksPage from '@/views/tasks';
import TopologyPage from '@/views/topology';
import UsersPage from '@/views/users';
import { loginLoader, requireSession } from './auth-loaders';
import { RouteError, RoutePending } from './RouteFeedback';

export const router = createBrowserRouter([
  {
    ErrorBoundary: RouteError,
    HydrateFallback: RoutePending,
    children: [
      { path: '/login', loader: loginLoader, Component: LoginPage },
      { path: '/accept-invitation', Component: AcceptInvitationPage },
      {
        path: '/',
        loader: requireSession,
        Component: AuthenticatedLayout,
        children: [
          { index: true, Component: HomePage },
          { path: 'nodes', Component: NodesPage },
          { path: 'nodes/:nodeId', Component: NodeDetailsPage },
          { path: 'protocol-presets', Component: ProtocolPresetsPage },
          { path: 'outbounds', Component: OutboundConfigsPage },
          { path: 'protocol-presets/new', Component: NewProtocolPresetPage },
          { path: 'protocol-presets/:presetId/edit', Component: NewProtocolPresetPage },
          { path: 'proxy-services', Component: ProxyServicesPage },
          { path: 'topology', Component: TopologyPage },
          { path: 'subscriptions', Component: SubscriptionsPage },
          { path: 'tasks', Component: TasksPage },
          { path: 'audit-logs', Component: AuditLogsPage },
          { path: 'settings', Component: SettingsPage },
          { path: 'users', Component: UsersPage },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
