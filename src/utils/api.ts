import type {
  Booking,
  CalendarStatus,
  EventType,
  EventTypeInput,
  Org,
  OrgInput,
  PublicEventType,
  Role,
  SlotDay,
  User,
} from '../types';

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

  // Calendar connection
  calendarStatus: () => request<CalendarStatus>('/api/calendar/status'),

  disconnectCalendar: () =>
    request<{ connected: boolean }>('/api/calendar/connect', { method: 'DELETE' }),

  // Event types
  listEventTypes: () => request<{ eventTypes: EventType[] }>('/api/event-types'),

  createEventType: (data: EventTypeInput) =>
    request<EventType>('/api/event-types', { method: 'POST', body: JSON.stringify(data) }),

  updateEventType: (id: string, data: Partial<EventTypeInput>) =>
    request<EventType>(`/api/event-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteEventType: (id: string) =>
    request<{ success: boolean }>(`/api/event-types/${id}`, { method: 'DELETE' }),

  eventTypeAvailability: (id: string) =>
    request<{ days: SlotDay[] }>(`/api/event-types/${id}/availability`),

  listBookings: () => request<{ bookings: Booking[] }>('/api/bookings'),

  // Public booking page (no authentication)
  bookingPage: (slug: string) =>
    request<{ eventType: PublicEventType; days: SlotDay[] }>(`/api/book/${slug}`),

  book: (slug: string, data: { start: string; name: string; email: string; notes: string }) =>
    request<{ ok: boolean; booking: { start: string; end: string; timezone: string; name: string; email: string; eventTypeName: string; ownerName: string } }>(
      `/api/book/${slug}`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

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
