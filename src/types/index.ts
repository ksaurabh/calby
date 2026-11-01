export type Role = 'user' | 'admin' | 'super_admin';

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain?: string;
  role: Role;
  createdAt?: string;
  createdBy?: string;
  lastLoginAt?: string | null;
}

export interface VirtualAssistantActivity {
  at: string;
  status: 'replied' | 'ignored' | 'error';
  from?: string;
  subject?: string;
  detail?: string;
}

export interface VirtualAssistant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  ownerDomain: string;
  createdBy: string;
  createdAt: string;
  connected: boolean;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  activity: VirtualAssistantActivity[];
}

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatAssistant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface AssistantChatVersion {
  content: string;
  at: string;
  hasTrace: boolean;
}

export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
  /** Assistant responses only: every generated version, and which is shown. */
  version?: number;
  versions?: AssistantChatVersion[];
}

/** Exactly what was sent to the model for one call, and what came back. */
export interface LlmCall {
  at: string;
  durationMs: number;
  request: {
    model: string;
    max_tokens: number;
    system: { type: string; text: string; cache_control?: unknown }[];
    messages: { role: string; content: unknown }[];
    tools?: { name: string; description: string; input_schema: unknown }[];
    tool_choice?: unknown;
  };
  response: {
    id: string;
    model: string;
    stop_reason: string | null;
    usage: Record<string, unknown>;
    content: unknown[];
  };
  cost: {
    model: string;
    pricePerMillion: { input: number; output: number };
    inputUsd: number;
    outputUsd: number;
    cacheWriteUsd: number;
    cacheReadUsd: number;
    totalUsd: number;
  };
}

/** Every model call made to produce one chat response, in order. */
export interface LlmTrace {
  version: number;
  at: string;
  durationMs: number;
  keySource: string | null;
  calls: LlmCall[];
  totalUsd: number;
}

export interface AssistantChatSummary {
  id: string;
  assistantId: string;
  assistantName: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantChatSession extends Omit<AssistantChatSummary, 'messageCount'> {
  messages: AssistantChatMessage[];
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  domain: string;
  /** An org key covers everyone on the org's domain. Never returned in full. */
  hasAnthropicKey?: boolean;
  anthropicKeyHint?: string | null;
  anthropicKeySetBy?: string | null;
  anthropicKeySetAt?: string | null;
  /** First person on the org's domain to sign in after it was created. */
  adminEmail: string | null;
  adminClaimedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgInput {
  name: string;
  domain?: string;
}

export interface SchedulingRules {
  /** Default length; durationOptions holds everything on offer. */
  durationMinutes: number;
  durationOptions: number[];
  horizonWeeks: number;
  timezone: string;
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxPerDay: number;
  summary: string;
}

export interface EventType {
  id: string;
  ownerEmail: string;
  /** Internal name — only the owner sees this. */
  name: string;
  /** Public name shown on the booking page and in the invite. */
  externalName: string;
  description: string;
  /** Plain-text availability guidance, read by the scheduling agent. */
  guidance: string;
  /** The 16-character public part of the booking URL. */
  slug: string;
  /** Commitment types whose entries may be booked over. */
  bookOverCommitmentTypeIds: string[];
  /** Colleagues who must also be free for a slot to be offered. */
  colleagueEmails: string[];
  rules: SchedulingRules;
  rulesSource: 'claude' | 'text';
  rulesUpdatedAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventTypeInput {
  name: string;
  externalName?: string;
  description?: string;
  guidance: string;
  active?: boolean;
  timezone?: string;
  bookOverCommitmentTypeIds?: string[];
  colleagueEmails?: string[];
}

/** Someone else on your domain whose calendar an event type can also check. */
export interface Colleague {
  email: string;
  name: string;
  picture?: string | null;
  /** Only a connected calendar can be checked for availability. */
  calendarConnected: boolean;
}

export interface Slot {
  start: string;
  end: string;
}

export interface SlotDay {
  date: string;
  slots: Slot[];
}

/** An event already on the owner's calendar. Owner-only — never sent publicly. */
export interface CalendarEvent {
  id: string;
  summary: string;
  allDay: boolean;
  start: string;
  end: string;
  location?: string;
  organizer?: EventPerson | null;
  creator?: EventPerson | null;
  attendees?: EventAttendee[];
  recurring?: boolean;
  link?: string | null;
  /** Which commitment type this entry was judged to satisfy, if any. */
  commitmentTypeId?: string | null;
}

export interface EventAttendee {
  email: string;
  name: string;
  responseStatus: string;
  organizer: boolean;
  self: boolean;
  optional: boolean;
}

export interface EventPerson {
  email: string;
  name: string;
  self: boolean;
}

/** One commitment type's verdict on a single calendar entry. */
export interface CommitmentVerdict {
  commitmentTypeId: string;
  name: string;
  color: string;
  condition: string;
  matches: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface EventExplanation {
  event: CalendarEvent;
  summary: string;
  verdicts: CommitmentVerdict[];
  /** When the model was actually called. Absent on reports cached before this. */
  calculatedAt?: string | null;
  /** True when this answer came from the cache rather than a fresh call. */
  cached?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A plain-text condition describing a kind of calendar entry, plus a colour. */
export interface CommitmentType {
  id: string;
  ownerEmail: string;
  name: string;
  condition: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommitmentTypeInput {
  name: string;
  condition: string;
  color?: string;
}

export interface PublicEventType {
  name: string;
  description: string;
  ownerName: string;
  durationMinutes: number;
  durationOptions: number[];
  /** The host's timezone, offered as a shortcut in the timezone picker. */
  timezone: string;
  availabilitySummary: string;
}

export interface Booking {
  id: string;
  eventTypeId: string;
  /** Internal name, for the owner's own list. */
  eventTypeName: string;
  eventTypeExternalName?: string;
  name: string;
  email: string;
  notes: string;
  start: string;
  end: string;
  durationMinutes?: number;
  timezone: string;
  googleEventLink: string | null;
  status: string;
  createdAt: string;
  /** Guest-facing links, also written into the calendar invite. */
  cancelUrl: string | null;
  rescheduleUrl: string | null;
}

/** What a cancel/reschedule page may see, addressed by the manage token. */
export interface ManagedBooking {
  eventTypeName: string;
  ownerName: string;
  name: string;
  email: string;
  notes: string;
  start: string;
  end: string;
  timezone: string;
  durationMinutes: number | null;
  status: string;
}

export interface CalendarStatus {
  connected: boolean;
  connectedAt: string | null;
  scopes: string[];
}
