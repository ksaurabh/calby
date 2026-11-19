import { useMemo } from 'react';
import type { CalendarEvent, CommitmentRule, CommitmentType, RuleCondition } from '../../types';
import {
  DAYS,
  FIELDS,
  classifyEvents,
  defaultCondition,
  defaultValue,
  describeCondition,
  eventFacts,
  conditionHolds,
  valueKind,
} from '../../../shared/commitmentRules';
import type { RuleField } from '../../../shared/commitmentRules';
import { formatDateTime } from '../../utils/format';
import { newRuleId } from './ruleIds';

const inputClass =
  'rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none bg-white';

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

/** Edit a commitment type's rules: any rule may match; within a rule, every condition must hold. */
export function RuleList({
  rules,
  onChange,
}: {
  rules: CommitmentRule[];
  onChange: (rules: CommitmentRule[]) => void;
}) {
  const setRule = (index: number, rule: CommitmentRule) =>
    onChange(rules.map((r, i) => (i === index ? rule : r)));

  return (
    <div className="space-y-3">
      {rules.map((rule, ruleIndex) => (
        <div key={rule.id}>
          {ruleIndex > 0 && (
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide text-center mb-3">or</div>
          )}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">
                Rule {ruleIndex + 1} — every condition must hold
              </span>
              <button
                type="button"
                className="text-xs text-gray-500 hover:text-red-600"
                onClick={() => onChange(rules.filter((_, i) => i !== ruleIndex))}
              >
                Remove rule
              </button>
            </div>
            <div className="space-y-2">
              {rule.conditions.map((condition, conditionIndex) => (
                <ConditionRow
                  key={conditionIndex}
                  condition={condition}
                  onChange={next =>
                    setRule(ruleIndex, {
                      ...rule,
                      conditions: rule.conditions.map((c, i) => (i === conditionIndex ? next : c)),
                    })
                  }
                  onRemove={
                    rule.conditions.length > 1
                      ? () =>
                          setRule(ruleIndex, {
                            ...rule,
                            conditions: rule.conditions.filter((_, i) => i !== conditionIndex),
                          })
                      : undefined
                  }
                />
              ))}
            </div>
            <button
              type="button"
              className="mt-2 text-xs text-blue-600 hover:text-blue-800"
              onClick={() => setRule(ruleIndex, { ...rule, conditions: [...rule.conditions, defaultCondition('title')] })}
            >
              + and…
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="text-sm text-blue-600 hover:text-blue-800"
        onClick={() => onChange([...rules, { id: newRuleId(), conditions: [defaultCondition('title')] }])}
      >
        + Add {rules.length ? 'another rule (or)' : 'a rule'}
      </button>
    </div>
  );
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: RuleCondition;
  onChange: (c: RuleCondition) => void;
  onRemove?: () => void;
}) {
  const spec = FIELDS[condition.field];
  const kind = valueKind(condition.field, condition.op);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        className={inputClass}
        value={condition.field}
        onChange={e => onChange(defaultCondition(e.target.value as RuleField))}
      >
        {(Object.keys(FIELDS) as RuleField[]).map(field => (
          <option key={field} value={field}>{FIELDS[field].label}</option>
        ))}
      </select>
      <select
        className={inputClass}
        value={condition.op}
        onChange={e => {
          const op = e.target.value;
          const nextKind = valueKind(condition.field, op);
          onChange({
            ...condition,
            op,
            value: nextKind === kind ? condition.value : defaultValue(nextKind),
          });
        }}
      >
        {Object.entries(spec.ops).map(([op, label]) => (
          <option key={op} value={op}>{label}</option>
        ))}
      </select>
      <ValueInput kind={kind} value={condition.value} onChange={value => onChange({ ...condition, value })} />
      {onRemove && (
        <button
          type="button"
          className="text-gray-400 hover:text-red-600 px-1"
          aria-label="Remove condition"
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </div>
  );
}

function ValueInput({
  kind,
  value,
  onChange,
}: {
  kind: ReturnType<typeof valueKind>;
  value: RuleCondition['value'];
  onChange: (v: RuleCondition['value']) => void;
}) {
  switch (kind) {
    case 'text':
      return (
        <input
          className={`${inputClass} flex-1 min-w-40`}
          value={String(value ?? '')}
          placeholder="e.g. sync, standup — commas mean any of"
          onChange={e => onChange(e.target.value)}
        />
      );
    case 'minutes':
    case 'number':
      return (
        <span className="inline-flex items-center gap-1">
          <input
            type="number"
            min={0}
            className={`${inputClass} w-20`}
            value={Number(value ?? 0)}
            onChange={e => onChange(Number(e.target.value))}
          />
          {kind === 'minutes' && <span className="text-sm text-gray-500">min</span>}
        </span>
      );
    case 'time':
      return (
        <input
          type="time"
          className={inputClass}
          value={String(value ?? '12:00')}
          onChange={e => onChange(e.target.value)}
        />
      );
    case 'days': {
      const days = Array.isArray(value) ? value : [];
      return (
        <span className="inline-flex flex-wrap gap-1">
          {DAYS.map(day => {
            const on = days.includes(day);
            return (
              <button
                key={day}
                type="button"
                className={`px-2 py-1 rounded text-xs border ${
                  on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600'
                }`}
                onClick={() => onChange(on ? days.filter(d => d !== day) : DAYS.filter(d => d === day || days.includes(d)))}
              >
                {DAY_LABELS[day]}
              </button>
            );
          })}
        </span>
      );
    }
    case 'boolean':
      return (
        <select className={inputClass} value={value ? 'yes' : 'no'} onChange={e => onChange(e.target.value === 'yes')}>
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      );
    default:
      return null;
  }
}

/**
 * What a draft type would match in the calendar loaded on the page — so rules
 * can be checked against real entries before saving.
 */
export function RulePreview({
  draft,
  commitmentTypes,
  events,
  timezone,
  ownerEmail,
}: {
  draft: { id: string | null; rules: CommitmentRule[] };
  commitmentTypes: CommitmentType[];
  events: CalendarEvent[];
  timezone: string;
  ownerEmail: string;
}) {
  const { matched, claimedBy } = useMemo(() => {
    const context = { timezone, ownerEmail };
    const rules = draft.rules.filter(r => r.conditions.length);
    // The draft on its own: every entry its rules match.
    const own = classifyEvents(events, [{ id: '__draft', rules }], context);
    const matched = events.filter(e => own.has(e.id));
    // In priority order, with the draft in its place (new types go last).
    const draftId = draft.id || '__draft';
    const ordered = draft.id
      ? commitmentTypes.map(t => (t.id === draft.id ? { ...t, rules } : t))
      : [...commitmentTypes, { id: draftId, rules }];
    const all = classifyEvents(matched, ordered, context);
    const claimedBy = new Map<string, string>();
    for (const e of matched) {
      const winner = all.get(e.id)?.typeId;
      if (winner && winner !== draftId) claimedBy.set(e.id, winner);
    }
    return { matched, claimedBy };
  }, [draft, commitmentTypes, events, timezone, ownerEmail]);

  const nameOf = (id: string) => commitmentTypes.find(t => t.id === id)?.name || id;

  if (!events.length) {
    return <p className="text-xs text-gray-500">Your calendar hasn't loaded, so there's nothing to preview against.</p>;
  }
  return (
    <div>
      <div className="text-sm font-medium text-gray-700">
        Matches {matched.length} of {events.length} entries in your calendar
        {claimedBy.size > 0 && (
          <span className="font-normal text-amber-700">
            {' '}· {claimedBy.size} go to a higher-priority type instead
          </span>
        )}
      </div>
      {matched.length > 0 && (
        <ul className="mt-2 max-h-56 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg text-sm">
          {matched.map(e => (
            <li key={e.id} className="px-3 py-1.5 flex items-baseline justify-between gap-3">
              <span className="truncate text-gray-900">{e.summary}</span>
              <span className="shrink-0 text-xs text-gray-500">
                {claimedBy.has(e.id) && <span className="text-amber-700">→ {nameOf(claimedBy.get(e.id)!)} · </span>}
                {formatDateTime(e.start, timezone)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Each type, rule and condition checked against one entry. */
export function RuleCheck({
  event,
  commitmentTypes,
  timezone,
  ownerEmail,
}: {
  event: CalendarEvent;
  commitmentTypes: CommitmentType[];
  timezone: string;
  ownerEmail: string;
}) {
  const facts = eventFacts(event, { timezone, ownerEmail });
  const winner = classifyEvents([event], commitmentTypes, { timezone, ownerEmail }).get(event.id);
  const people = facts.attendeeEmails;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
        <div className="font-medium text-gray-900">{event.summary}</div>
        <div className="text-gray-600">
          {event.allDay ? 'All day' : formatDateTime(event.start, timezone)} · {facts.durationMinutes} min
        </div>
        <div className="text-gray-600">
          Organizer: {facts.organizerIsMe ? 'you' : facts.organizerEmail}
          {!facts.organizerIsMe && (facts.organizerInternal ? ' (your domain)' : ' (outside your domain)')}
        </div>
        <div className="text-gray-600">
          {people.length ? `Attendees (${people.length}): ${people.join(', ')}` : 'No other attendees'}
        </div>
      </div>

      <div className="text-sm">
        {winner ? (
          <>
            Labelled{' '}
            <strong>{commitmentTypes.find(t => t.id === winner.typeId)?.name}</strong> by rule {winner.ruleIndex + 1}.
          </>
        ) : (
          <>No commitment type's rules match this entry.</>
        )}
      </div>

      <div className="space-y-3">
        {commitmentTypes.map(type => {
          const rules = type.rules || [];
          return (
            <div key={type.id} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-3 h-3 rounded border"
                  style={{ backgroundColor: `${type.color}33`, borderColor: type.color }}
                />
                <span className="font-medium text-sm text-gray-900">{type.name}</span>
                {winner?.typeId === type.id && <span className="text-xs text-green-700">✓ chosen</span>}
              </div>
              {rules.length === 0 ? (
                <div className="text-xs text-gray-500">No rules yet.</div>
              ) : (
                <ul className="space-y-1.5">
                  {rules.map((rule, i) => {
                    const results = rule.conditions.map(c => conditionHolds(c, facts));
                    const holds = results.every(Boolean);
                    return (
                      <li key={rule.id} className="text-xs">
                        <span className={holds ? 'text-green-700 font-medium' : 'text-gray-500'}>
                          Rule {i + 1} {holds ? 'matches' : 'does not match'}
                        </span>
                        <ul className="ml-3 mt-0.5">
                          {rule.conditions.map((c, j) => (
                            <li key={j} className={results[j] ? 'text-green-700' : 'text-red-600'}>
                              {results[j] ? '✓' : '✗'} {describeCondition(c)}
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
