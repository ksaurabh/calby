import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, CommitmentRule, CommitmentType } from '../../types';
import { classifyEvents, describeRule } from '../../../shared/commitmentRules';
import { api } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { AvailabilityCalendar } from '../calendar';
import { Button, Modal } from '../common';
import { CalendarChat } from './CalendarChat';
import { RuleCheck, RuleList, RulePreview } from './RuleEditor';
import { newRuleId } from './ruleIds';

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

const EXAMPLES: { name: string; rules: CommitmentRule[] }[] = [
  {
    name: 'Customer calls',
    rules: [{ id: 'x1', conditions: [{ field: 'attendees', op: 'anyExternal', value: null }] }],
  },
  {
    name: 'Internal',
    rules: [{
      id: 'x2',
      conditions: [
        { field: 'attendees', op: 'allInternal', value: null },
        { field: 'attendeeCount', op: 'atLeast', value: 1 },
      ],
    }],
  },
  {
    name: 'Focus time',
    rules: [{ id: 'x3', conditions: [{ field: 'title', op: 'contains', value: 'focus, deep work, writing' }] }],
  },
  {
    name: 'Personal',
    rules: [{ id: 'x4', conditions: [{ field: 'title', op: 'contains', value: 'dentist, doctor, flight, pto, vacation' }] }],
  },
];

interface FormState {
  id: string | null;
  name: string;
  rules: CommitmentRule[];
  color: string;
}

const UNMATCHED = '__none';

export function CommitmentTypesPage() {
  const [commitmentTypes, setCommitmentTypes] = useState<CommitmentType[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [timezone, setTimezone] = useState('UTC');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [checking, setChecking] = useState<CalendarEvent | null>(null);

  const [filter, setFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const data = await api.calendarEvents();
      setEvents(data.events);
      setTimezone(data.timezone);
      setOwnerEmail(data.ownerEmail);
      setCalendarError(null);
    } catch (e) {
      setCalendarError((e as Error).message);
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.listCommitmentTypes();
      setCommitmentTypes(data.commitmentTypes);
      setColors(data.colors);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadCalendar();
  }, [load, loadCalendar]);

  // Labels come from the rules, worked out right here — the same code the
  // server runs — so edits show up immediately.
  const mapping = useMemo(
    () => classifyEvents(events, commitmentTypes, { timezone, ownerEmail }),
    [events, commitmentTypes, timezone, ownerEmail]
  );
  const labelled = useMemo(
    () => events.map(e => ({ ...e, commitmentTypeId: mapping.get(e.id)?.typeId || null })),
    [events, mapping]
  );
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of mapping.values()) c.set(m.typeId, (c.get(m.typeId) || 0) + 1);
    return c;
  }, [mapping]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return labelled
      .filter(e => {
        if (!filter) return true;
        if (filter === UNMATCHED) return !e.commitmentTypeId;
        return e.commitmentTypeId === filter;
      })
      .filter(e =>
        !q ||
        e.summary.toLowerCase().includes(q) ||
        (e.organizer?.email || '').toLowerCase().includes(q) ||
        (e.attendees || []).some(a => a.email.toLowerCase().includes(q))
      )
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [labelled, filter, search]);

  const typeById = (id: string | null | undefined) => commitmentTypes.find(t => t.id === id);

  const openNew = (preset?: { name: string; rules: CommitmentRule[] }) =>
    setForm({
      id: null,
      name: preset?.name || '',
      rules: (preset?.rules || [{ id: newRuleId(), conditions: [{ field: 'title', op: 'contains', value: '' }] }])
        .map(r => ({ ...r, id: newRuleId() })),
      color: colors[commitmentTypes.length % (colors.length || 1)] || '#2563eb',
    });

  const openEdit = (t: CommitmentType, extraRule?: CommitmentRule) =>
    setForm({
      id: t.id,
      name: t.name,
      rules: [...(t.rules || []), ...(extraRule ? [extraRule] : [])],
      color: t.color,
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { name: form.name.trim(), rules: form.rules, color: form.color };
      if (form.id) await api.updateCommitmentType(form.id, payload);
      else await api.createCommitmentType(payload);
      setForm(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (commitmentType: CommitmentType) => {
    if (!window.confirm(`Delete "${commitmentType.name}"?`)) return;
    await api.deleteCommitmentType(commitmentType.id);
    await load();
  };

  const move = async (index: number, delta: number) => {
    const ids = commitmentTypes.map(t => t.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    const { commitmentTypes: next } = await api.reorderCommitmentTypes(ids);
    setCommitmentTypes(next);
  };

  // From the per-entry check: a rule that catches entries with this exact title.
  const addRuleFor = (event: CalendarEvent, typeId: string) => {
    const type = typeById(typeId);
    if (!type) return;
    setChecking(null);
    openEdit(type, {
      id: newRuleId(),
      conditions: [{ field: 'title', op: 'is', value: event.summary }],
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Commitment types</h1>
          <p className="text-sm text-gray-500 mt-1">
            Rules sort your calendar entries into types by title, duration, start time,
            organizer and attendees. An entry takes the first type, top to bottom, with a
            matching rule.
          </p>
        </div>
        <Button onClick={() => openNew()}>+ New commitment type</Button>
      </div>

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">Loading…</div>
      ) : commitmentTypes.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10">
          <div className="text-center">
            <div className="text-4xl mb-3">🎨</div>
            <h2 className="font-medium text-gray-900">No commitment types yet</h2>
            <p className="text-sm text-gray-500 mt-1">Start from one of these, or write your own.</p>
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map(example => (
              <button
                key={example.name}
                onClick={() => openNew(example)}
                className="text-left border border-gray-200 rounded-lg p-3 hover:border-blue-500 hover:bg-blue-50 transition-colors"
              >
                <div className="text-sm font-medium text-gray-900">{example.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">{example.rules.map(describeRule).join('; or ')}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {commitmentTypes.map((commitmentType, index) => (
            <div key={commitmentType.id} className="p-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex flex-col -my-1">
                  <button
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-20 text-xs leading-4"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="Higher priority"
                  >
                    ▲
                  </button>
                  <button
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-20 text-xs leading-4"
                    disabled={index === commitmentTypes.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="Lower priority"
                  >
                    ▼
                  </button>
                </div>
                <span
                  className="mt-1 w-4 h-4 rounded shrink-0 border"
                  style={{ backgroundColor: `${commitmentType.color}33`, borderColor: commitmentType.color }}
                />
                <div className="min-w-0">
                  <div className="font-medium text-gray-900">
                    {commitmentType.name}
                    <button
                      className="ml-2 text-xs font-normal text-blue-600 hover:underline"
                      onClick={() => setFilter(commitmentType.id)}
                    >
                      {counts.get(commitmentType.id) || 0} entries
                    </button>
                  </div>
                  {commitmentType.rules.length ? (
                    <ul className="text-sm text-gray-600 mt-0.5 space-y-0.5">
                      {commitmentType.rules.map((rule, i) => (
                        <li key={rule.id}>
                          {i > 0 && <span className="text-gray-400">or </span>}
                          {describeRule(rule)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-amber-700 mt-0.5">
                      No rules yet, so nothing is labelled with this type.
                      {commitmentType.legacyCondition && (
                        <span className="text-gray-500"> It used to mean: “{commitmentType.legacyCondition}”.</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" onClick={() => openEdit(commitmentType)}>Edit rules</Button>
                <Button variant="ghost" onClick={() => remove(commitmentType)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Calendar coloured by commitment type, plus the assistant */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-900">Your calendar</h2>
              <p className="text-xs text-gray-500 mt-1">
                Coloured by commitment type. Click an entry to see which rules match it.
              </p>
              {!calendarLoading && !calendarError && (
                <p className="text-xs text-gray-500 mt-1">
                  {mapping.size} of {events.length} entries matched a commitment type
                </p>
              )}
            </div>
            <Button variant="secondary" onClick={loadCalendar}>Refresh</Button>
          </div>

          {calendarError ? (
            <div className="rounded-lg bg-amber-50 text-amber-800 px-4 py-3 text-sm">{calendarError}</div>
          ) : calendarLoading ? (
            <div className="py-10 text-center text-gray-500">Loading your calendar…</div>
          ) : (
            <AvailabilityCalendar
              events={labelled}
              commitmentTypes={commitmentTypes}
              window={{ timezone, startMinute: 8 * 60, endMinute: 19 * 60, weeks: 4 }}
              onSelectEvent={setChecking}
            />
          )}
        </div>

        <CalendarChat />
      </div>

      {/* Every entry and the type it was given, to check the rules against */}
      {!calendarLoading && !calendarError && (
        <div className="mt-8 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-gray-900">Entries and their types</h2>
              <p className="text-xs text-gray-500 mt-1">
                Last week through the next four. Click a row to see why it got its type.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                placeholder="Search title or email"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              >
                <option value="">All types ({events.length})</option>
                {commitmentTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({counts.get(t.id) || 0})</option>
                ))}
                <option value={UNMATCHED}>No type ({events.length - mapping.size})</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Title</th>
                  <th className="py-2 pr-3 font-medium">Length</th>
                  <th className="py-2 pr-3 font-medium">Organizer</th>
                  <th className="py-2 pr-3 font-medium">Attendees</th>
                  <th className="py-2 font-medium">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="py-6 text-center text-gray-500">No entries.</td></tr>
                ) : rows.map(e => {
                  const m = mapping.get(e.id);
                  const type = typeById(m?.typeId);
                  const others = (e.attendees || []).filter(a => !a.self && !/resource\.calendar/.test(a.email));
                  const minutes = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000);
                  return (
                    <tr key={e.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setChecking(e)}>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-600">
                        {e.allDay ? `${e.start.slice(0, 10)} · all day` : formatDateTime(e.start, timezone)}
                      </td>
                      <td className="py-2 pr-3 text-gray-900 max-w-xs truncate">{e.summary}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{e.allDay ? '—' : `${minutes}m`}</td>
                      <td className="py-2 pr-3 text-gray-600 max-w-[12rem] truncate">
                        {!e.organizer || e.organizer.self ? 'you' : e.organizer.email}
                      </td>
                      <td className="py-2 pr-3 text-gray-600 max-w-[14rem] truncate" title={others.map(a => a.email).join(', ')}>
                        {others.length ? `${others.length} · ${others.map(a => a.email).join(', ')}` : '—'}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        {type ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs border"
                            style={{ backgroundColor: `${type.color}1a`, borderColor: type.color }}
                          >
                            {type.name}
                            <span className="text-gray-500">rule {m!.ruleIndex + 1}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">none</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={!!checking} onClose={() => setChecking(null)} title="Which rules match" size="wide">
        {checking && (
          <>
            <RuleCheck
              event={checking}
              commitmentTypes={commitmentTypes}
              timezone={timezone}
              ownerEmail={ownerEmail}
            />
            {commitmentTypes.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-600">Add a rule for entries titled exactly “{checking.summary}” to</span>
                {commitmentTypes.map(t => (
                  <Button key={t.id} variant="secondary" onClick={() => addRuleFor(checking, t.id)}>
                    {t.name}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal
        isOpen={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit commitment type' : 'New commitment type'}
        size="wide"
      >
        {form && (
          <form onSubmit={submit} className="space-y-5">
            <div className="flex gap-4 flex-wrap">
              <div className="flex-1 min-w-48">
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
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
                      onClick={() => setForm({ ...form, color })}
                      aria-label={`Use colour ${color}`}
                      className={`w-7 h-7 rounded-lg border-2 transition-transform ${
                        form.color === color ? 'scale-110 ring-2 ring-offset-1 ring-gray-400' : ''
                      }`}
                      style={{ backgroundColor: `${color}33`, borderColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Rules</label>
              <RuleList rules={form.rules} onChange={rules => setForm({ ...form, rules })} />
            </div>

            <RulePreview
              draft={{ id: form.id, rules: form.rules }}
              commitmentTypes={commitmentTypes}
              events={events}
              timezone={timezone}
              ownerEmail={ownerEmail}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : form.id ? 'Save changes' : 'Create'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
