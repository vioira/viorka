import type { Session } from './auth';
import { apiRequest } from './client';
export type Role = Session['user']['role'];
export type Account = {
  id: string;
  username: string;
  email: string;
  role: Role;
  status: 'active' | 'invited';
  expires_at?: string;
};
export interface Invitation {
  id: string;
  token: string;
  expires_at: string;
}
export const listUsers = (after = '', signal?: AbortSignal) =>
  apiRequest<{ items: Account[] }>('/users', { query: { limit: 50, after }, signal });
export const inviteUser = (session: Session, username: string, email: string, role: Role) =>
  apiRequest<Invitation>('/users/invitations', {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { username, email, role },
  });
export const removeUser = (session: Session, id: string) =>
  apiRequest(`/users/${id}`, {
    method: 'DELETE',
    csrfToken: session.csrf_token,
    responseType: 'void',
  });
export const changeUserRole = (session: Session, id: string, role: Role) =>
  apiRequest(`/users/${id}/role`, {
    method: 'PUT',
    csrfToken: session.csrf_token,
    json: { role },
    responseType: 'void',
  });
export const acceptInvitation = (token: string, password: string) =>
  apiRequest('/auth/accept-invitation', {
    method: 'POST',
    json: { token, password },
    responseType: 'void',
  });
