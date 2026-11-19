export type RuleField =
  | 'title' | 'duration' | 'start' | 'day' | 'allDay'
  | 'organizer' | 'attendees' | 'attendeeCount';

export type ValueKind = 'text' | 'minutes' | 'number' | 'time' | 'days' | 'boolean';

export interface RuleCondition {
  field: RuleField;
  op: string;
  value: string | number | boolean | string[] | null;
}

export interface CommitmentRule {
  id: string;
  conditions: RuleCondition[];
}

export interface RuleEvent {
  id: string;
  summary?: string;
  start: string;
  end: string;
  allDay?: boolean;
  organizer?: { email: string; self?: boolean } | null;
  attendees?: { email: string; self?: boolean }[];
}

export interface RuleType {
  id: string;
  rules?: CommitmentRule[];
}

export interface RuleContext {
  timezone: string;
  ownerEmail: string;
}

export interface EventFacts {
  title: string;
  durationMinutes: number;
  allDay: boolean;
  day: string;
  startMinutes: number | null;
  organizerEmail: string;
  organizerIsMe: boolean;
  organizerInternal: boolean;
  attendeeEmails: string[];
  myDomain: string;
}

export interface Explanation {
  facts: EventFacts;
  typeId: string | null;
  types: {
    typeId: string;
    matches: boolean;
    rules: { id: string; holds: boolean; conditions: (RuleCondition & { holds: boolean; text: string })[] }[];
  }[];
}

export const FIELDS: Record<RuleField, {
  label: string;
  ops: Record<string, string>;
  value: ValueKind | Record<string, ValueKind>;
}>;
export const DAYS: string[];
export function valueKind(field: RuleField, op: string): ValueKind | null;
export function defaultCondition(field?: RuleField): RuleCondition;
export function defaultValue(kind: ValueKind | null): RuleCondition['value'];
export function sanitizeRules(rules: unknown): CommitmentRule[];
export function eventFacts(event: RuleEvent, context: RuleContext): EventFacts;
export function conditionHolds(condition: RuleCondition, facts: EventFacts): boolean;
export function classifyEvents(
  events: RuleEvent[],
  types: RuleType[],
  context: RuleContext,
): Map<string, { typeId: string; ruleIndex: number }>;
export function assignmentsFor(events: RuleEvent[], types: RuleType[], context: RuleContext): Map<string, string>;
export function explainEvent(event: RuleEvent, types: RuleType[], context: RuleContext): Explanation;
export function describeCondition(condition: RuleCondition): string;
export function describeRule(rule: CommitmentRule): string;
export function describeRules(rules: CommitmentRule[] | undefined): string;
