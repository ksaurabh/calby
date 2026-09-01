import type {
  Booking,
  CalendarEvent,
  CalendarStatus,
  ChatMessage,
  CommitmentType,
  CommitmentTypeInput,
  EventExplanation,
  EventType,
  EventTypeInput,
  ManagedBooking,
  Org,
  OrgInput,
  PublicEventType,
  Role,
  SchedulingRules,
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

  // The owner's own calendar, labelled by commitment type
  calendarEvents: () =>
    request<{
      events: CalendarEvent[];
      commitmentTypes: CommitmentType[];
      timezone: string;
      from: string;
      to: string;
      classification: { cached: number; pending: number };
    }>('/api/calendar/events'),

  startClassification: () =>
    request<{
      jobId: string | null;
      total: number;
      done: number;
      finished: boolean;
      assignments: Record<string, string>;
    }>('/api/calendar/classify', { method: 'POST', body: JSON.stringify({}) }),

  classificationProgress: (jobId: string) =>
    request<{
      total: number;
      done: number;
      finished: boolean;
      error: string | null;
      assignments: Record<string, string>;
    }>(`/api/calendar/classify/${jobId}`),

  askCalendar: (question: string, history: ChatMessage[]) =>
    request<{ answer: string; eventsConsidered: number; timezone: string }>('/api/calendar/ask', {
      method: 'POST',
      body: JSON.stringify({ question, history }),
    }),

  explainEvent: (eventId: string) =>
    request<EventExplanation & { cached: boolean }>('/api/calendar/explain', {
      method: 'POST',
      body: JSON.stringify({ eventId }),
    }),

  // Commitment types
  listCommitmentTypes: () =>
    request<{ commitmentTypes: CommitmentType[]; colors: string[] }>('/api/commitment-types'),

  createCommitmentType: (data: CommitmentTypeInput) =>
    request<CommitmentType>('/api/commitment-types', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCommitmentType: (id: string, data: Partial<CommitmentTypeInput>) =>
    request<CommitmentType>(`/api/commitment-types/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteCommitmentType: (id: string) =>
    request<{ success: boolean }>(`/api/commitment-types/${id}`, { method: 'DELETE' }),

  // Event types
  listEventTypes: () => request<{ eventTypes: EventType[] }>('/api/event-types'),

  createEventType: (data: EventTypeInput) =>
    request<EventType>('/api/event-types', { method: 'POST', body: JSON.stringify(data) }),

  updateEventType: (id: string, data: Partial<EventTypeInput>) =>
    request<EventType>(`/api/event-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteEventType: (id: string) =>
    request<{ success: boolean }>(`/api/event-types/${id}`, { method: 'DELETE' }),

  eventTypeAvailability: (id: string, durationMinutes?: number) =>
    request<{
      days: SlotDay[];
      rules: SchedulingRules;
      events: CalendarEvent[];
      commitmentTypes: CommitmentType[];
      durationMinutes: number;
    }>(
      `/api/event-types/${id}/availability${durationMinutes ? `?duration=${durationMinutes}` : ''}`
    ),

  listBookings: () => request<{ bookings: Booking[] }>('/api/bookings'),

  // Public booking page (no authentication)
  bookingPage: (slug: string, durationMinutes?: number) =>
    request<{ eventType: PublicEventType; days: SlotDay[] }>(
      `/api/book/${slug}${durationMinutes ? `?duration=${durationMinutes}` : ''}`
    ),

  book: (
    slug: string,
    data: { start: string; name: string; email: string; notes: string; durationMinutes: number }
  ) =>
    request<{
      ok: boolean;
      booking: {
        start: string; end: string; timezone: string; name: string; email: string;
        eventTypeName: string; ownerName: string; cancelUrl: string; rescheduleUrl: string;
      };
    }>(`/api/book/${slug}`, { method: 'POST', body: JSON.stringify(data) }),

  // Manage an existing booking from the links in the calendar invite
  managedBooking: (token: string) =>
    request<{ booking: ManagedBooking; days: SlotDay[] }>(`/api/booking/${token}`),

  cancelBooking: (token: string, reason: string) =>
    request<{ ok: boolean; alreadyCancelled?: boolean }>(`/api/booking/${token}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  rescheduleBooking: (token: string, start: string) =>
    request<{ ok: boolean; booking: ManagedBooking }>(`/api/booking/${token}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ start }),
    }),

  // Orgs
  listOrgs: () => request<{ orgs: Org[] }>('/api/orgs'),

  createOrg: (org: OrgInput) =>
    request<Org>('/api/orgs', { method: 'POST', body: JSON.stringify(org) }),

  updateOrg: (id: string, updates: Partial<OrgInput>) =>
    request<Org>(`/api/orgs/${id}`, { method: 'PUT', body: JSON.stringify(updates) }),

  deleteOrg: (id: string) =>
    request<{ success: boolean }>(`/api/orgs/${id}`, { method: 'DELETE' }),

  setOrgAnthropicKey: (id: string, apiKey: string) =>
    request<Org>(`/api/orgs/${id}/anthropic-key`, {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  removeOrgAnthropicKey: (id: string) =>
    request<Org>(`/api/orgs/${id}/anthropic-key`, { method: 'DELETE' }),

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
