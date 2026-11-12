import { createBrowserRouter, Navigate, useLocation } from 'react-router';
import AuthenticatedLayout from '@/layouts/AuthenticatedLayout';
import SectionLayout from '@/layouts/SectionLayout';
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
import { loginLoader, requireSession, revalidateSession } from './auth-loaders';
import { RouteError, RoutePending } from './RouteFeedback';

const legacyRoutes: Record<string, string> = {
  'proxy-services': '/proxy/services',
  'protocol-presets': '/proxy/protocol-presets',
  outbounds: '/proxy/outbounds',
  tasks: '/operations/tasks',
  'audit-logs': '/operations/audit-logs',
};

function LegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  const [, root, ...rest] = pathname.split('/');
  const suffix = rest.length ? `/${rest.join('/')}` : '';
  return <Navigate to={`${legacyRoutes[root]}${suffix}${search}${hash}`} replace />;
}

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
        shouldRevalidate: revalidateSession,
        Component: AuthenticatedLayout,
        children: [
          { index: true, Component: HomePage },
          { path: 'nodes', Component: NodesPage },
          { path: 'nodes/:nodeId', Component: NodeDetailsPage, handle: { headerBreadcrumb: true } },
          {
            path: 'proxy',
            element: <SectionLayout section="proxy" />,
            children: [
              { index: true, element: <Navigate to="services" replace /> },
              { path: 'services', Component: ProxyServicesPage },
              { path: 'protocol-presets', Component: ProtocolPresetsPage },
              { path: 'protocol-presets/new', Component: NewProtocolPresetPage },
              { path: 'protocol-presets/:presetId/edit', Component: NewProtocolPresetPage },
              { path: 'outbounds', Component: OutboundConfigsPage },
            ],
          },
          {
            path: 'operations',
            element: <SectionLayout section="operations" />,
            children: [
              { index: true, element: <Navigate to="tasks" replace /> },
              { path: 'tasks', Component: TasksPage },
              { path: 'audit-logs', Component: AuditLogsPage },
            ],
          },
          ...Object.keys(legacyRoutes).map((path) => ({
            path: `${path}/*`,
            Component: LegacyRedirect,
          })),
          { path: 'topology', Component: TopologyPage },
          { path: 'subscriptions', Component: SubscriptionsPage },
          { path: 'settings', Component: SettingsPage },
          { path: 'users', Component: UsersPage },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
