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

// A page tab changes local content only; explicit revalidation and navigation
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
    currentUrl.search !== nextUrl.search
  ) {
    const before = new URLSearchParams(currentUrl.search);
    const after = new URLSearchParams(nextUrl.search);
    for (const key of ['tab', 'view']) {
      before.delete(key);
      after.delete(key);
    }
    if (before.toString() === after.toString()) return false;
  }
  return defaultShouldRevalidate;
};
