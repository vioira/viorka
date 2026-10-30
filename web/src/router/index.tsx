import { createBrowserRouter, Navigate } from 'react-router';
import HomePage from '@/views/home';
import LoginPage from '@/views/login';
import { loginLoader, requireSession } from './auth-loaders';
import { RouteError, RoutePending } from './RouteFeedback';

export const router = createBrowserRouter([
  {
    ErrorBoundary: RouteError,
    HydrateFallback: RoutePending,
    children: [
      { path: '/login', loader: loginLoader, Component: LoginPage },
      { path: '/', loader: requireSession, Component: HomePage },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
