import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, CommitmentRule, CommitmentType } from '../../types';
import { classifyEvents } from '../../../shared/commitmentRules';
import { api } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { Button } from '../common';
import { RuleList } from './RuleEditor';

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

// The preview always looks at the coming two weeks.
const NEXT_TWO_WEEKS = { back: 0, forward: 14 };

export interface TypeDraft {
  id: string | null;
  name: string;
  description: string;
  mode: 'rules' | 'ai';
  rules: CommitmentRule[];
  color: string;
}

export function TypeEditor({
  initial,
  colors,
  commitmentTypes,
  onSave,
  onCancel,
}: {
  initial: TypeDraft;
  colors: string[];
  commitmentTypes: CommitmentType[];
  onSave: (draft: TypeDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TypeDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [translating, setTranslating] = useState(false);
  const [unsupported, setUnsupported] = useState('');

  // The next two weeks of the calendar, fetched once when the editor opens.
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [context, setContext] = useState({ timezone: 'UTC', ownerEmail: '' });
  const [eventsError, setEventsError] = useState<string | null>(null);

  // AI preview: run on request, since each run can cost model calls.
  const [aiResult, setAiResult] = useState<{ description: string; matched: Set<string> } | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    api.calendarEvents(NEXT_TWO_WEEKS)
      .then(data => {
        setEvents([...data.events].sort((a, b) => a.start.localeCompare(b.start)));
        setContext({ timezone: data.timezone, ownerEmail: data.ownerEmail });
      })
      .catch(e => setEventsError((e as Error).message));
  }, []);

  const set = (patch: Partial<TypeDraft>) => setDraft(d => ({ ...d, ...patch }));

  const translate = async () => {
    setTranslating(true);
    setError(null);
    setUnsupported('');
    try {
      const { rules, unsupported } = await api.translateRules(draft.description);
      if (!rules.length) {
        setError('Couldn’t turn that into rules — try naming words in the title, who attends, times or lengths.');
      } else {
        set({ rules });
      }
      setUnsupported(unsupported);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTranslating(false);
    }
  };

  const runAi = async () => {
    setAiRunning(true);
    setAiError(null);
    try {
      const { matchedIds, error } = await api.aiPreview(draft.description, NEXT_TWO_WEEKS);
      setAiResult({ description: draft.description, matched: new Set(matchedIds) });
      if (error) setAiError(error);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiRunning(false);
    }
  };

  // What this type matches on its own, and which of those a higher-priority
  // type takes first (rules only — other AI types aren't re-run here).
  const preview = useMemo(() => {
    if (!events) return null;
    let own: Set<string>;
    if (draft.mode === 'ai') {
      if (!aiResult || aiResult.description !== draft.description) return { stale: true as const };
      own = aiResult.matched;
    } else {
      const rules = draft.rules.filter(r => r.conditions.length);
      const m = classifyEvents(events, [{ id: 'draft', rules }], context);
      own = new Set(m.keys());
    }
    const draftId = draft.id || '__draft';
    const before = commitmentTypes
      .slice(0, draft.id ? commitmentTypes.findIndex(t => t.id === draft.id) : commitmentTypes.length)
      .filter(t => t.id !== draftId && t.mode !== 'ai');
    const earlier = classifyEvents(events.filter(e => own.has(e.id)), before, context);
    return {
      stale: false as const,
      matched: events.filter(e => own.has(e.id)),
      unmatched: events.filter(e => !own.has(e.id)),
      claimedBy: new Map([...earlier].map(([id, m]) => [id, m.typeId])),
    };
  }, [events, draft, aiResult, commitmentTypes, context]);

  const nameOf = (id: string) => commitmentTypes.find(t => t.id === id)?.name || '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            className={inputClass}
            value={draft.name}
            onChange={e => set({ name: e.target.value })}
            placeholder="Customer calls"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Colour</label>
          <div className="flex flex-wrap gap-1.5">
            {colors.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => set({ color })}
                aria-label={`Use colour ${color}`}
                className={`w-7 h-7 rounded-lg border-2 transition-transform ${
                  draft.color === color ? 'scale-110 ring-2 ring-offset-1 ring-gray-400' : ''
                }`}
                style={{ backgroundColor: `${color}33`, borderColor: color }}
              />
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Describe it in plain English</label>
        <textarea
          className={`${inputClass} min-h-20`}
          value={draft.description}
          onChange={e => set({ description: e.target.value })}
          placeholder="Meetings with anyone outside airmdr.com, except recruiting interviews"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <button
              type="button"
              role="switch"
              aria-checked={draft.mode === 'ai'}
              onClick={() => set({ mode: draft.mode === 'ai' ? 'rules' : 'ai' })}
              className={`relative w-9 h-5 rounded-full transition-colors ${draft.mode === 'ai' ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  draft.mode === 'ai' ? 'translate-x-4' : ''
                }`}
              />
            </button>
            Let AI decide from this description instead of rules
          </label>
          {draft.mode === 'rules' && (
            <Button
              type="button"
              variant="secondary"
              disabled={!draft.description.trim() || translating}
              onClick={translate}
            >
              {translating ? 'Translating…' : draft.rules.length ? 'Re-translate to rules' : 'Translate to rules'}
            </Button>
          )}
        </div>
        {draft.mode === 'ai' && (
          <p className="text-xs text-gray-500 mt-1">
            Claude reads each entry and decides whether it fits. Answers are remembered per
            entry, so only new or changed entries cost a call.
          </p>
        )}
      </div>

      {draft.mode === 'rules' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Rules</label>
          {unsupported && (
            <div className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-xs mb-2">
              Not covered by the rules: {unsupported}
            </div>
          )}
          <RuleList rules={draft.rules} onChange={rules => set({ rules })} />
        </div>
      )}

      <div className="border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-sm font-medium text-gray-700">Your next 2 weeks</h3>
          {draft.mode === 'ai' && (
            <Button
              type="button"
              variant="secondary"
              disabled={!draft.description.trim() || aiRunning}
              onClick={runAi}
            >
              {aiRunning ? 'Asking AI…' : 'Check with AI'}
            </Button>
          )}
        </div>
        {aiError && <div className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-xs mb-2">{aiError}</div>}
        {eventsError ? (
          <div className="text-sm text-amber-700">{eventsError}</div>
        ) : !events || !preview ? (
          <div className="text-sm text-gray-500">Loading your calendar…</div>
        ) : preview.stale ? (
          <div className="text-sm text-gray-500">
            {aiRunning ? 'Claude is reading your entries…' : 'Click “Check with AI” to see what it would match.'}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <EventColumn
              title={`Matched (${preview.matched.length})`}
              tone="green"
              events={preview.matched}
              timezone={context.timezone}
              note={id => (preview.claimedBy.has(id) ? `→ ${nameOf(preview.claimedBy.get(id)!)} first` : null)}
            />
            <EventColumn
              title={`Not matched (${preview.unmatched.length})`}
              tone="gray"
              events={preview.unmatched}
              timezone={context.timezone}
            />
          </div>
        )}
        {preview && !preview.stale && preview.claimedBy.size > 0 && (
          <p className="text-xs text-amber-700 mt-2">
            {preview.claimedBy.size} matched {preview.claimedBy.size === 1 ? 'entry goes' : 'entries go'} to a
            higher-priority type instead.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

function EventColumn({
  title,
  tone,
  events,
  timezone,
  note,
}: {
  title: string;
  tone: 'green' | 'gray';
  events: CalendarEvent[];
  timezone: string;
  note?: (id: string) => string | null;
}) {
  return (
    <div className={`rounded-lg border ${tone === 'green' ? 'border-green-200' : 'border-gray-200'}`}>
      <div
        className={`px-3 py-1.5 text-xs font-medium border-b ${
          tone === 'green' ? 'bg-green-50 text-green-800 border-green-200' : 'bg-gray-50 text-gray-600 border-gray-200'
        }`}
      >
        {title}
      </div>
      <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 text-sm">
        {events.length === 0 ? (
          <li className="px-3 py-2 text-xs text-gray-400">None</li>
        ) : events.map(e => {
          const n = note?.(e.id);
          return (
            <li key={e.id} className="px-3 py-1.5">
              <div className="truncate text-gray-900">{e.summary}</div>
              <div className="text-xs text-gray-500">
                {e.allDay ? `${e.start.slice(0, 10)} · all day` : formatDateTime(e.start, timezone)}
                {n && <span className="text-amber-700"> · {n}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
