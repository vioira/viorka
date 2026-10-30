import { type LoaderFunctionArgs, redirect } from 'react-router';
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
