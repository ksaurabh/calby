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

export interface Org {
  id: string;
  name: string;
  slug: string;
  domain: string;
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
  durationMinutes: number;
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
  name: string;
  description: string;
  /** Plain-text availability guidance, read by the scheduling agent. */
  guidance: string;
  /** The 16-character public part of the booking URL. */
  slug: string;
  rules: SchedulingRules;
  rulesSource: 'claude' | 'text';
  rulesUpdatedAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventTypeInput {
  name: string;
  description?: string;
  guidance: string;
  active?: boolean;
  timezone?: string;
}

export interface Slot {
  start: string;
  end: string;
}

export interface SlotDay {
  date: string;
  slots: Slot[];
}

export interface PublicEventType {
  name: string;
  description: string;
  ownerName: string;
  durationMinutes: number;
  timezone: string;
  availabilitySummary: string;
}

export interface Booking {
  id: string;
  eventTypeId: string;
  eventTypeName: string;
  name: string;
  email: string;
  notes: string;
  start: string;
  end: string;
  timezone: string;
  googleEventLink: string | null;
  status: string;
  createdAt: string;
}

export interface CalendarStatus {
  connected: boolean;
  connectedAt: string | null;
  scopes: string[];
}
