import type {
  ZoomSummary,
  TodoReport,
  IgnoreRule,
  IntegrationStatus,
  AttendedMeeting,
  RecordingSource,
  AssistantChatSession,
  AssistantChatSummary,
  ChatAssistant,
  LlmTrace,
  Note,
  Booking,
  CalendarEvent,
  CalendarStatus,
  Colleague,
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
  VirtualAssistant,
} from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

/** A proposed guidance edit that would let one time be booked, checked by the server. */
export interface GuidanceSuggestion {
  guidance: string;
  change: string;
  readAs: string;
  /** The guidance no longer stands in the way of the time. */
  verified: boolean;
  /** The time would actually be offered (nothing else blocks it either). */
  opensSlot: boolean;
  remainingReasons: { code: string; detail: string }[];
}

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
      classification: {
        cached: number;
        pending: number;
        matched: number;
        method: 'model' | 'keyword';
      };
    }>('/api/calendar/events'),

  startClassification: () =>
    request<{
      jobId: string | null;
      total: number;
      done: number;
      finished: boolean;
      method: 'model' | 'keyword';
      assignments: Record<string, string>;
    }>('/api/calendar/classify', { method: 'POST', body: JSON.stringify({}) }),

  classificationProgress: (jobId: string) =>
    request<{
      total: number;
      done: number;
      finished: boolean;
      error: string | null;
      method: 'model' | 'keyword';
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

  // LLM cost
  usage: (scope: 'me' | 'org' = 'me') =>
    request<{
      scope: 'me' | 'org';
      canSeeOrg: boolean;
      timezone: string;
      days: number;
      last24h: { costUsd: number; calls: number };
      total: { costUsd: number; calls: number };
      daily: { date: string; costUsd: number; calls: number; inputTokens: number; outputTokens: number }[];
      byFeature: { feature: string; costUsd: number; calls: number }[];
    }>(`/api/usage?scope=${scope}`),

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
  // Colleagues on your domain, for checking their availability too
  listColleagues: () => request<{ colleagues: Colleague[] }>('/api/colleagues'),

  listEventTypes: () => request<{ eventTypes: EventType[] }>('/api/event-types'),

  createEventType: (data: EventTypeInput) =>
    request<EventType>('/api/event-types', { method: 'POST', body: JSON.stringify(data) }),

  updateEventType: (id: string, data: Partial<EventTypeInput>) =>
    request<EventType>(`/api/event-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteEventType: (id: string) =>
    request<{ success: boolean }>(`/api/event-types/${id}`, { method: 'DELETE' }),

  // Steps a slow request has gone through so far (see progressId params).
  progress: (id: string) =>
    request<{ steps: { message: string; offsetMs: number }[]; elapsedMs: number }>(
      `/api/progress/${encodeURIComponent(id)}`
    ),

  // The owner's preview. `guidance` previews unsaved guidance; `refresh`
  // re-reads the calendar from Google instead of using the recent copy.
  eventTypeAvailability: (
    id: string,
    options: { durationMinutes?: number; guidance?: string; refresh?: boolean } = {},
    progressId?: string
  ) =>
    request<{
      days: SlotDay[];
      rules: SchedulingRules;
      guidance: string;
      draft: boolean;
      events: CalendarEvent[];
      commitmentTypes: CommitmentType[];
      durationMinutes: number;
      reviewNote: string | null;
      drops: { start: string; reason: string }[];
      calendarFetchedAt: string;
    }>(
      `/api/event-types/${id}/availability${progressId ? `?progress=${encodeURIComponent(progressId)}` : ''}`,
      { method: 'POST', body: JSON.stringify(options) }
    ),

  listBookings: () => request<{ bookings: Booking[] }>('/api/bookings'),

  suggestSlots: (
    eventTypeId: string,
    options: {
      count: number;
      fromBusinessDay: number;
      toBusinessDay: number;
      durationMinutes: number;
      guidance?: string;
    }
  ) =>
    request<{
      slots: { start: string; end: string }[];
      consideredDays: string[];
      totalAvailable: number;
      count: number;
      fromBusinessDay: number;
      toBusinessDay: number;
      durationMinutes: number;
      timezone: string;
    }>(`/api/event-types/${eventTypeId}/suggest-slots`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  explainSlot: (eventTypeId: string, start: string, durationMinutes: number, guidance?: string) =>
    request<{
      start: string;
      durationMinutes: number;
      open: boolean;
      reasons: { code: string; detail: string }[];
      explanation: string;
      explained: boolean;
      fixableByGuidance: boolean;
      suggestion: GuidanceSuggestion | null;
      guidance: string;
      draft: boolean;
      readAs: string;
      calendarFetchedAt: string;
    }>(`/api/event-types/${eventTypeId}/slot-explanation`, {
      method: 'POST',
      body: JSON.stringify({ start, durationMinutes, guidance }),
    }),

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

  // Your own Avoma and Gong connections
  integrations: () =>
    request<{ avoma: IntegrationStatus; gong: IntegrationStatus; zoom: IntegrationStatus }>('/api/settings/integrations'),

  setAvoma: (apiKey: string) =>
    request<{ avoma: IntegrationStatus; gong: IntegrationStatus; zoom: IntegrationStatus }>('/api/settings/avoma', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  setGong: (accessKey: string, secretKey: string) =>
    request<{ avoma: IntegrationStatus; gong: IntegrationStatus; zoom: IntegrationStatus }>('/api/settings/gong', {
      method: 'PUT',
      body: JSON.stringify({ accessKey, secretKey }),
    }),

  setZoom: (creds: { accountId: string; clientId: string; clientSecret: string; userEmail: string }) =>
    request<{ avoma: IntegrationStatus; gong: IntegrationStatus; zoom: IntegrationStatus }>('/api/settings/zoom', {
      method: 'PUT',
      body: JSON.stringify(creds),
    }),

  // Your saved credentials in full, to edit or copy them
  integrationCredentials: (service: 'avoma' | 'gong' | 'zoom') =>
    request<Record<string, string>>(`/api/settings/${service}/credentials`),

  removeIntegration: (service: 'avoma' | 'gong' | 'zoom') =>
    request<{ avoma: IntegrationStatus; gong: IntegrationStatus; zoom: IntegrationStatus }>(`/api/settings/${service}`, { method: 'DELETE' }),

  // Recordings from Avoma and Gong, and calendar meetings without one
  recordings: (options: { days: number; scope: 'me' | 'all'; refresh?: boolean }, progressId?: string) =>
    request<{
      days: number;
      scope: 'me' | 'all';
      from: string;
      to: string;
      fetchedAt: string;
      timezone: string;
      avoma: RecordingSource;
      gong: RecordingSource;
      zoom: RecordingSource;
      calendar: {
        connected: boolean;
        error: string | null;
        meetings: AttendedMeeting[];
        unrecorded: AttendedMeeting[];
        ignored: AttendedMeeting[];
      };
      ignoreRules: IgnoreRule[];
    }>(`/api/recordings?${new URLSearchParams({
      days: String(options.days),
      scope: options.scope,
      ...(options.refresh ? { refresh: '1' } : {}),
      ...(progressId ? { progress: progressId } : {}),
    })}`),

  // What Avoma says about one meeting (live), to check its recorded status
  avomaMeeting: (uuid: string) =>
    request<{
      signals: Record<string, string | number | boolean | null>;
      recorded: boolean | null;
      reason: string;
    }>(`/api/recordings/avoma/${encodeURIComponent(uuid)}`),

  // Zoom-only meetings: a summary, and the recording file
  zoomSummary: (id: string, refresh = false, progressId?: string) =>
    request<{ summary: ZoomSummary }>(
      `/api/recordings/zoom/summary${progressId ? `?progress=${encodeURIComponent(progressId)}` : ''}`,
      { method: 'POST', body: JSON.stringify({ id, refresh }) }
    ),

  zoomDownloadUrl: (id: string) => `${API_URL}/api/recordings/zoom/download?id=${encodeURIComponent(id)}`,

  // To-do report from your recorded meetings' summary notes
  todoReport: () => request<{ report: TodoReport | null }>('/api/recordings/todos'),

  createTodoReport: (days: number, progressId?: string) =>
    request<{ report: TodoReport }>(
      `/api/recordings/todos${progressId ? `?progress=${encodeURIComponent(progressId)}` : ''}`,
      { method: 'POST', body: JSON.stringify({ days }) }
    ),

  // Meetings you don't want flagged as unrecorded
  ignoreMeeting: (meeting: { eventId: string; title: string; start: string; recurringEventId: string | null; always: boolean }) =>
    request<{ ok: boolean; rule: IgnoreRule | null }>('/api/recordings/ignore', {
      method: 'POST',
      body: JSON.stringify(meeting),
    }),

  unignoreMeeting: (eventId: string) =>
    request<{ ok: boolean }>(`/api/recordings/ignore/${encodeURIComponent(eventId)}`, { method: 'DELETE' }),

  removeIgnoreRule: (id: string) =>
    request<{ ok: boolean }>(`/api/recordings/ignore-rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),

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

  // Notes — context for your virtual assistant
  listNotes: () => request<{ notes: Note[]; maxChars: number }>('/api/notes'),

  createNote: (data: { title: string; body: string }) =>
    request<Note>('/api/notes', { method: 'POST', body: JSON.stringify(data) }),

  updateNote: (id: string, data: { title?: string; body?: string }) =>
    request<Note>(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteNote: (id: string) =>
    request<{ success: boolean }>(`/api/notes/${id}`, { method: 'DELETE' }),

  // Chat with your virtual assistant
  chatAssistants: () => request<{ assistants: ChatAssistant[] }>('/api/chat/assistants'),

  listChatSessions: () => request<{ sessions: AssistantChatSummary[] }>('/api/chat/sessions'),

  createChatSession: (assistantId?: string) =>
    request<AssistantChatSession>('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ assistantId }),
    }),

  chatSession: (id: string) => request<AssistantChatSession>(`/api/chat/sessions/${id}`),

  deleteChatSession: (id: string) =>
    request<{ success: boolean }>(`/api/chat/sessions/${id}`, { method: 'DELETE' }),

  regenerateChatMessage: (id: string, index: number) =>
    request<AssistantChatSession>(`/api/chat/sessions/${id}/messages/${index}/regenerate`, {
      method: 'POST',
    }),

  selectChatVersion: (id: string, index: number, version: number) =>
    request<AssistantChatSession>(`/api/chat/sessions/${id}/messages/${index}/version`, {
      method: 'PUT',
      body: JSON.stringify({ version }),
    }),

  chatTrace: (id: string, index: number, version: number) =>
    request<LlmTrace>(`/api/chat/sessions/${id}/messages/${index}/trace?version=${version}`),

  sendChatMessage: (id: string, content: string) =>
    request<AssistantChatSession>(`/api/chat/sessions/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  // Virtual assistants
  listVirtualAssistants: () =>
    request<{ assistants: VirtualAssistant[] }>('/api/virtual-assistants'),

  createVirtualAssistant: (data: { firstName: string; lastName: string; email: string }) =>
    request<VirtualAssistant>('/api/virtual-assistants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteVirtualAssistant: (id: string) =>
    request<{ success: boolean }>(`/api/virtual-assistants/${id}`, { method: 'DELETE' }),

  disconnectVirtualAssistant: (id: string) =>
    request<VirtualAssistant>(`/api/virtual-assistants/${id}/connect`, { method: 'DELETE' }),

  checkVirtualAssistant: (id: string) =>
    request<{
      result: { checked?: number; replied?: number; error?: string; skipped?: string; limited?: boolean };
      assistant: VirtualAssistant;
    }>(`/api/virtual-assistants/${id}/check`, { method: 'POST' }),

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
