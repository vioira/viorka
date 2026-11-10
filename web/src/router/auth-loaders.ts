import { type LoaderFunctionArgs, redirect, type ShouldRevalidateFunction } from 'react-router';
import { getSession } from '@/api/auth';

export async function requireSession({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.signal);
  if (!session) throw redirect('/login');
  return session;
}

export async function loginLoader({ request }: LoaderFunctionArgs) {
  if (await getSession(request.signal)) throw redirect('/');
  return null;
}

// A detail tab changes local content only; explicit revalidation and navigation
// to another resource still refresh the authoritative session loader.
export const revalidateSession: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  if (
    !formMethod &&
    currentUrl.pathname === nextUrl.pathname &&
    /^\/nodes\/[^/]+$/.test(nextUrl.pathname) &&
    currentUrl.searchParams.get('tab') !== nextUrl.searchParams.get('tab')
  ) {
    const before = new URLSearchParams(currentUrl.search);
    before.delete('tab');
    const after = new URLSearchParams(nextUrl.search);
    after.delete('tab');
    if (before.toString() === after.toString()) return false;
  }
  return defaultShouldRevalidate;
};
