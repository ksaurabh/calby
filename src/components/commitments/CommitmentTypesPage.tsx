import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, CommitmentRule, CommitmentType } from '../../types';
import { classifyEvents, describeRule } from '../../../shared/commitmentRules';
import { api } from '../../utils/api';
import { formatTime } from '../../utils/format';
import { AvailabilityCalendar } from '../calendar';
import { Button, Modal } from '../common';
import { CalendarChat } from './CalendarChat';
import { RuleCheck } from './RuleEditor';
import { TypeEditor } from './TypeEditor';
import type { TypeDraft } from './TypeEditor';
import { newRuleId } from './ruleIds';

const EXAMPLES: { name: string; description: string; rules: CommitmentRule[] }[] = [
  {
    name: 'Customer calls',
    description: 'Meetings with anyone outside my domain',
    rules: [{ id: 'x1', conditions: [{ field: 'attendees', op: 'anyExternal', value: null }] }],
  },
  {
    name: 'Internal',
    description: 'Meetings where everyone is on my domain',
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
    description: 'Blocks I hold for focus or deep work',
    rules: [{ id: 'x3', conditions: [{ field: 'title', op: 'contains', value: 'focus, deep work, writing' }] }],
  },
  {
    name: 'Personal',
    description: 'Appointments, travel and time off',
    rules: [{ id: 'x4', conditions: [{ field: 'title', op: 'contains', value: 'dentist, doctor, flight, pto, vacation' }] }],
  },
];

const UNMATCHED = '__none';
const VIEW_KEY = 'commitments.calendarView';

// "Mon, Nov 18" in the owner's timezone; an all-day entry's date as written.
const dayLabel = (e: CalendarEvent, timeZone: string) =>
  e.allDay
    ? new Date(`${e.start.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
      })
    : new Date(e.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone });

function savedView(): 'calendar' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'calendar';
  } catch {
    return 'calendar';
  }
}

export function CommitmentTypesPage() {
  const [commitmentTypes, setCommitmentTypes] = useState<CommitmentType[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [form, setForm] = useState<TypeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [timezone, setTimezone] = useState('UTC');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [aiMatches, setAiMatches] = useState<Map<string, Set<string>>>(new Map());
  const [aiErrors, setAiErrors] = useState<string[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [checking, setChecking] = useState<CalendarEvent | null>(null);

  const [filter, setFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'calendar' | 'list'>(savedView);
  const chooseView = (v: 'calendar' | 'list') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Remembering the choice is only a convenience.
    }
  };

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const data = await api.calendarEvents();
      setEvents(data.events);
      setTimezone(data.timezone);
      setOwnerEmail(data.ownerEmail);
      setAiMatches(new Map(Object.entries(data.aiMatches || {}).map(([id, ids]) => [id, new Set(ids)])));
      setAiErrors(data.aiErrors || []);
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
    () => classifyEvents(events, commitmentTypes, { timezone, ownerEmail, aiMatches }),
    [events, commitmentTypes, timezone, ownerEmail, aiMatches]
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

  const openNew = (preset?: { name: string; description: string; rules: CommitmentRule[] }) =>
    setForm({
      id: null,
      name: preset?.name || '',
      description: preset?.description || '',
      mode: 'rules',
      rules: (preset?.rules || []).map(r => ({ ...r, id: newRuleId() })),
      color: colors[commitmentTypes.length % (colors.length || 1)] || '#2563eb',
    });

  const openEdit = (t: CommitmentType, extraRule?: CommitmentRule) =>
    setForm({
      id: t.id,
      name: t.name,
      description: t.description || '',
      mode: extraRule ? 'rules' : t.mode,
      rules: [...(t.rules || []), ...(extraRule ? [extraRule] : [])],
      color: t.color,
    });

  const save = async (draft: TypeDraft) => {
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      mode: draft.mode,
      rules: draft.rules,
      color: draft.color,
    };
    if (draft.id) await api.updateCommitmentType(draft.id, payload);
    else await api.createCommitmentType(payload);
    setForm(null);
    await load();
    // AI-decided types are labelled on the server, so re-read the calendar.
    if (draft.mode === 'ai') await loadCalendar();
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
                <div className="text-xs text-gray-500 mt-0.5">{example.description}</div>
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
                      onClick={() => { setFilter(commitmentType.id); chooseView('list'); }}
                    >
                      {counts.get(commitmentType.id) || 0} entries
                    </button>
                  </div>
                  {commitmentType.description && (
                    <div className="text-sm text-gray-700 mt-0.5">{commitmentType.description}</div>
                  )}
                  {commitmentType.mode === 'ai' ? (
                    <div className="text-xs text-violet-700 mt-0.5">AI decides from the description</div>
                  ) : commitmentType.rules.length ? (
                    <ul className="text-xs text-gray-500 mt-0.5 space-y-0.5">
                      {commitmentType.rules.map((rule, i) => (
                        <li key={rule.id}>
                          {i > 0 && <span className="text-gray-400">or </span>}
                          {describeRule(rule)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-amber-700 mt-0.5">
                      No rules yet, so nothing is labelled with this type. Edit it to translate the
                      description into rules, or let AI decide.
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" onClick={() => openEdit(commitmentType)}>Edit</Button>
                <Button variant="ghost" onClick={() => remove(commitmentType)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Calendar coloured by commitment type, as a grid or a list, plus the assistant */}
      <div className={`mt-8 grid gap-6 ${view === 'calendar' ? 'lg:grid-cols-3' : ''}`}>
        <div className={`${view === 'calendar' ? 'lg:col-span-2' : ''} bg-white rounded-xl border border-gray-200 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-gray-900">Your calendar</h2>
              <p className="text-xs text-gray-500 mt-1">
                Last week through the next four, coloured by commitment type. Click an entry
                to see which rules match it.
              </p>
              {!calendarLoading && !calendarError && (
                <p className="text-xs text-gray-500 mt-1">
                  {mapping.size} of {events.length} entries matched a commitment type
                </p>
              )}
              {aiErrors.map(err => (
                <p key={err} className="text-xs text-amber-700 mt-1">{err}</p>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-gray-300 p-0.5" role="tablist">
                {(['calendar', 'list'] as const).map(v => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => chooseView(v)}
                    className={`px-3 py-1 text-sm rounded-md ${
                      view === v ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {v === 'calendar' ? 'Calendar' : 'List'}
                  </button>
                ))}
              </div>
              <Button variant="secondary" onClick={loadCalendar}>Refresh</Button>
            </div>
          </div>

          {calendarError ? (
            <div className="rounded-lg bg-amber-50 text-amber-800 px-4 py-3 text-sm">{calendarError}</div>
          ) : calendarLoading ? (
            <div className="py-10 text-center text-gray-500">Loading your calendar…</div>
          ) : view === 'calendar' ? (
            <AvailabilityCalendar
              events={labelled}
              commitmentTypes={commitmentTypes}
              window={{ timezone, startMinute: 8 * 60, endMinute: 19 * 60, weeks: 4 }}
              onSelectEvent={setChecking}
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                <input
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 flex-1 min-w-48"
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">Title and type</th>
                      <th className="py-2 pr-3 font-medium">Length</th>
                      <th className="py-2 pr-3 font-medium">Organizer</th>
                      <th className="py-2 font-medium">Attendees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={5} className="py-6 text-center text-gray-500">No entries.</td></tr>
                    ) : rows.map((e, i) => {
                      const m = mapping.get(e.id);
                      const type = typeById(m?.typeId);
                      const others = (e.attendees || []).filter(a => !a.self && !/resource\.calendar/.test(a.email));
                      const minutes = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000);
                      const day = dayLabel(e, timezone);
                      const newDay = i === 0 || dayLabel(rows[i - 1], timezone) !== day;
                      return (
                        <Fragment key={e.id}>
                          {newDay && (
                            <tr>
                              <td colSpan={5} className="pt-4 pb-1 text-xs font-semibold text-gray-700 border-b border-gray-200">
                                {day}
                              </td>
                            </tr>
                          )}
                          <tr
                            className="hover:bg-gray-50 cursor-pointer border-b border-gray-100"
                            onClick={() => setChecking(e)}
                          >
                            <td className="py-2 pr-3 whitespace-nowrap text-gray-600">
                              {e.allDay ? 'All day' : formatTime(e.start, timezone)}
                            </td>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-gray-900 truncate">{e.summary}</span>
                                <FreeBusy event={e} />
                                {type ? (
                                  <span
                                    className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border whitespace-nowrap"
                                    style={{ backgroundColor: `${type.color}1a`, borderColor: type.color }}
                                    title={m!.ruleIndex < 0 ? 'Decided by AI' : `Matched rule ${m!.ruleIndex + 1}`}
                                  >
                                    {type.name}
                                    <span className="text-gray-500">{m!.ruleIndex < 0 ? 'AI' : `rule ${m!.ruleIndex + 1}`}</span>
                                  </span>
                                ) : (
                                  <span className="shrink-0 text-xs text-gray-400 whitespace-nowrap">no type</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{e.allDay ? '—' : `${minutes}m`}</td>
                            <td className="py-2 pr-3 text-gray-600 max-w-[12rem] truncate">
                              {!e.organizer || e.organizer.self ? 'you' : e.organizer.email}
                            </td>
                            <td className="py-2 text-gray-600 max-w-[14rem] truncate" title={others.map(a => a.email).join(', ')}>
                              {others.length ? `${others.length} · ${others.map(a => a.email).join(', ')}` : '—'}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <CalendarChat />
      </div>

      <Modal isOpen={!!checking} onClose={() => setChecking(null)} title="Which rules match" size="wide">
        {checking && (
          <>
            <RuleCheck
              event={checking}
              commitmentTypes={commitmentTypes}
              timezone={timezone}
              ownerEmail={ownerEmail}
              aiMatches={aiMatches}
            />
            {commitmentTypes.some(t => t.mode === 'rules') && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-600">Add a rule for entries titled exactly “{checking.summary}” to</span>
                {commitmentTypes.filter(t => t.mode === 'rules').map(t => (
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
          <TypeEditor
            key={form.id || 'new'}
            initial={form}
            colors={colors}
            commitmentTypes={commitmentTypes}
            onSave={save}
            onCancel={() => setForm(null)}
          />
        )}
      </Modal>
    </div>
  );
}

/** Busy or free as Google sees it: "Show as", and declining, both free the time. */
function FreeBusy({ event }: { event: CalendarEvent }) {
  if (event.myResponse === 'declined') {
    return (
      <span className="shrink-0 rounded px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 line-through" title="You declined — doesn't block your time">
        declined
      </span>
    );
  }
  const free = event.showAs === 'free';
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
        free ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-800 text-white'
      }`}
      title={free ? 'Shows as free in Google Calendar' : 'Shows as busy in Google Calendar'}
    >
      {free ? 'free' : 'busy'}
      {!free && event.myResponse === 'tentative' && ' · maybe'}
    </span>
  );
}
