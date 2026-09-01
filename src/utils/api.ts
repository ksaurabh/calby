import type { Org, OrgInput, Role, User } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

export const api = {
  // Session
  setActiveRole: (role: Role) =>
    request<{ ok: boolean; role: Role; actualRole: Role }>('/api/session/role', {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),

  // Orgs
  listOrgs: () => request<{ orgs: Org[] }>('/api/orgs'),

  createOrg: (org: OrgInput) =>
    request<Org>('/api/orgs', { method: 'POST', body: JSON.stringify(org) }),

  updateOrg: (id: string, updates: Partial<OrgInput>) =>
    request<Org>(`/api/orgs/${id}`, { method: 'PUT', body: JSON.stringify(updates) }),

  deleteOrg: (id: string) =>
    request<{ success: boolean }>(`/api/orgs/${id}`, { method: 'DELETE' }),

  // Users
  listUsers: () =>
    request<{ users: User[]; scopedToDomains: string[] | null }>('/api/users'),

  createUser: (data: { email: string; name: string }) =>
    request<User & { canSignIn: boolean }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteUser: (email: string) =>
    request<{ success: boolean; releasedOrgs: boolean }>(
      `/api/users/${encodeURIComponent(email)}`,
      { method: 'DELETE' }
    ),

  setUserRole: (email: string, role: 'user' | 'admin') =>
    request<User>(`/api/users/${encodeURIComponent(email)}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  // Domains
  listDomains: () => request<{ domains: string[]; alwaysAllowed: string[] }>('/api/domains'),

  addDomain: (domain: string) =>
    request<{ domains: string[]; alwaysAllowed: string[] }>('/api/domains', {
      method: 'POST',
      body: JSON.stringify({ domain }),
    }),

  removeDomain: (domain: string) =>
    request<{ domains: string[]; alwaysAllowed: string[] }>(
      `/api/domains/${encodeURIComponent(domain)}`,
      { method: 'DELETE' }
    ),
};
