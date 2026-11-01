import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AttendedMeeting, IgnoreRule, Recording, RecordingSource, RecordingSourceName } from '../../types';
import { api } from '../../utils/api';
import { navigate } from '../../utils/navigate';
import { Button, ProgressSteps } from '../common';
import { TodoReportPanel } from './TodoReportPanel';
import type { ProgressStep } from '../common/ProgressSteps';

type Data = Awaited<ReturnType<typeof api.recordings>>;

const SOURCE_STYLE: Record<RecordingSourceName, string> = {
  avoma: 'bg-violet-50 text-violet-700 border-violet-200',
  gong: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  zoom: 'bg-sky-50 text-sky-700 border-sky-200',
};
const SOURCE_LABEL: Record<RecordingSourceName, string> = { avoma: 'Avoma', gong: 'Gong', zoom: 'Zoom' };

function matchNote(how?: 'meeting number' | 'time', deltaMinutes?: number) {
  if (!how) return '';
  return how === 'meeting number'
    ? `matched by Zoom meeting number${deltaMinutes ? `, started ${deltaMinutes} min apart` : ''}`
    : `matched by time — started ${deltaMinutes ? `${deltaMinutes} min apart` : 'at the same minute'}`;
}

function when(iso: string | null, timeZone: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function People({ people, max = 4 }: { people: { email: string; name: string }[]; max?: number }) {
  if (!people.length) return <span className="text-gray-400">—</span>;
  const shown = people.slice(0, max);
  return (
    <span className="text-gray-600">
      {shown.map((p, i) => (
        <span key={`${p.email}-${i}`} title={p.email || undefined}>
          {i > 0 && ', '}
          {p.name && p.name !== p.email ? p.name : p.email}
        </span>
      ))}
      {people.length > max && <span className="text-gray-400"> +{people.length - max} more</span>}
    </span>
  );
}

function ruleLabel(rule: IgnoreRule) {
  return rule.kind === 'series'
    ? `the recurring "${rule.title || 'untitled'}" series`
    : `every meeting titled "${rule.title || rule.value}"`;
}

function SourceBadge({ source }: { source: RecordingSourceName }) {
  return (
    <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded border ${SOURCE_STYLE[source]}`}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

function MeetingsTable({ meetings, timezone, showRecordings, actions }: {
  meetings: AttendedMeeting[];
  timezone: string;
  showRecordings?: boolean;
  /** Buttons at the end of each row. */
  actions?: (meeting: AttendedMeeting) => ReactNode;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <th className="px-4 py-2 font-medium w-44">When</th>
          <th className="px-4 py-2 font-medium">Meeting</th>
          <th className="px-4 py-2 font-medium">With</th>
          {showRecordings && <th className="px-4 py-2 font-medium">Recording</th>}
          {actions && <th className="px-4 py-2" />}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {meetings.map(m => (
          <tr key={m.id} className="align-top">
            <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{when(m.start, timezone)}</td>
            <td className="px-4 py-2 text-gray-900">
              {m.link ? (
                <a href={m.link} target="_blank" rel="noreferrer" className="hover:underline">{m.title}</a>
              ) : m.title}
            </td>
            <td className="px-4 py-2"><People people={m.attendees} /></td>
            {showRecordings && (
              <td className="px-4 py-2 space-x-1 whitespace-nowrap">
                {m.recordings.map(r => (
                  <a
                    key={`${r.source}-${r.id}`}
                    href={r.url || undefined}
                    target="_blank"
                    rel="noreferrer"
                    title={[
                      r.title,
                      matchNote(r.how, r.deltaMinutes),
                      r.unconfirmed && 'Avoma did not say whether it recorded this',
                    ].filter(Boolean).join(' · ')}
                  >
                    <SourceBadge source={r.source} />
                    {r.unconfirmed && <span className="text-[11px] text-amber-600">?</span>}
                  </a>
                ))}
              </td>
            )}
            {actions && <td className="px-4 py-1.5 text-right whitespace-nowrap">{actions(m)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecordingsTable({ label, source, data, timezone }: {
  label: string;
  source: RecordingSource;
  data: Data;
  timezone: string;
}) {
  const [open, setOpen] = useState(true);
  const isAvoma = label === 'Avoma';
  const notRecorded = source.meetings.filter(m => m.recorded === false).length;
  const unconfirmed = source.meetings.filter(m => m.recorded == null).length;
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-gray-50"
        onClick={() => setOpen(o => !o)}
      >
        <div>
          <h2 className="font-semibold text-gray-900">
            {label}{' '}
            {source.connected && (
              <span className="text-gray-400 font-normal">
                ({source.meetings.length}{isAvoma && notRecorded > 0 ? `, ${notRecorded} not recorded` : ''})
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500">
            {!source.connected
              ? `Not connected — add your ${label} API key in Settings.`
              : `${data.scope === 'all' ? `Everything your ${label} key can see` : 'Meetings you were in'}, last ${data.days} days`}
          </p>
        </div>
        <span className="text-gray-400 text-sm">{open ? '▾' : '▸'}</span>
      </button>
      {open && source.connected && (
        <>
          {source.error && <div className="mx-5 mb-3 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{source.error}</div>}
          {source.truncated && (
            <div className="mx-5 mb-3 rounded-lg bg-amber-50 text-amber-900 px-3 py-2 text-xs">
              There were more than could be read in one go; the oldest may be missing.
            </div>
          )}
          {isAvoma && notRecorded > 0 && (
            <p className="px-5 pb-2 text-xs text-gray-500">
              {notRecorded} of these {notRecorded === 1 ? 'was' : 'were'} not recorded by Avoma, so{' '}
              {notRecorded === 1 ? "it doesn't" : "they don't"} count as a recording of any meeting.
            </p>
          )}
          {!source.error && source.meetings.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-gray-500">No meetings in this window.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium w-44">When</th>
                  <th className="px-4 py-2 font-medium">Meeting</th>
                  <th className="px-4 py-2 font-medium">Attendees</th>
                  {isAvoma && <th className="px-4 py-2 font-medium w-56">Recorded?</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {source.meetings.map((m: Recording) => (
                  <tr key={m.id} className="align-top">
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{when(m.start, timezone)}</td>
                    <td className="px-4 py-2 text-gray-900">
                      {m.url ? <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">{m.title}</a> : m.title}
                    </td>
                    <td className="px-4 py-2">
                      <People people={m.attendees} max={5} />
                      <span className="text-xs text-gray-400"> · {m.attendees.length}</span>
                    </td>
                    {isAvoma && (
                      <td className="px-4 py-2">
                        <RecordedVerdict recorded={m.recorded} reason={m.reason} />
                        {m.signals && (
                          <details className="text-[11px] text-gray-500">
                            <summary className="cursor-pointer">What Avoma says</summary>
                            <SignalList signals={m.signals} />
                          </details>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {isAvoma && source.diagnostics && source.meetings.length > 0 && (
            <details className="px-5 py-3 border-t border-gray-100 text-xs text-gray-500">
              <summary className="cursor-pointer">What Avoma sent (to check how it marks recordings)</summary>
              <AvomaLookupBox />
              <p className="mt-2">
                {unconfirmed > 0
                  ? `${unconfirmed} meeting${unconfirmed === 1 ? '' : 's'} had no recognisable recording signal and are shown as "Not confirmed" (still counted as recorded). `
                  : ''}
                Fields: <code className="font-mono">{source.diagnostics.fields.join(', ')}</code>
              </p>
              {Object.keys(source.diagnostics.values).length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(source.diagnostics.values).map(([field, counts]) => (
                    <li key={field}>
                      <code className="font-mono">{field}</code>:{' '}
                      {Object.entries(counts).map(([value, n]) => `${value} ×${n}`).join(', ')}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}

type AvomaLookup = Awaited<ReturnType<typeof api.avomaMeeting>>;

function SignalList({ signals }: { signals: Record<string, string | number | boolean | null> }) {
  const entries = Object.entries(signals);
  if (!entries.length) return <span className="text-gray-400">No status fields.</span>;
  return (
    <code className="font-mono text-[11px] text-gray-700 break-words">
      {entries.map(([k, v]) => `${k}: ${v === null ? 'null' : String(v)}`).join(' · ')}
    </code>
  );
}

function RecordedVerdict({ recorded, reason }: { recorded: boolean | null | undefined; reason?: string }) {
  return (
    <>
      {recorded === true ? (
        <span className="text-xs text-emerald-700">Recorded</span>
      ) : recorded === false ? (
        <span className="text-xs text-gray-500">Not recorded</span>
      ) : (
        <span className="text-xs text-amber-700">Not confirmed</span>
      )}
      {reason && <div className="text-[11px] text-gray-400">{reason}</div>}
    </>
  );
}

// Ask Avoma live about one meeting — by pasting its link or id.
function AvomaLookupBox() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<AvomaLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const look = async (e: React.FormEvent) => {
    e.preventDefault();
    const uuid = (input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [input.trim()])[0];
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.avomaMeeting(uuid));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3">
      <form onSubmit={look} className="flex gap-2 flex-wrap">
        <input
          className="flex-1 min-w-64 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
          placeholder="Paste an Avoma meeting link to see what Avoma says about it"
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={busy || !input.trim()}>
          {busy ? 'Asking Avoma…' : 'Check'}
        </Button>
      </form>
      {error && <div className="mt-2 text-red-700">{error}</div>}
      {result && (
        <div className="mt-2 rounded-md bg-gray-50 p-2 space-y-1">
          <div><RecordedVerdict recorded={result.recorded} reason={result.reason} /></div>
          <SignalList signals={result.signals} />
        </div>
      )}
    </div>
  );
}

function ZoomTable({ source, timezone, days }: { source: RecordingSource; timezone: string; days: number }) {
  const [open, setOpen] = useState(true);
  const unmatched = source.meetings.filter(m => !m.matchedMeeting).length;
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-gray-50"
        onClick={() => setOpen(o => !o)}
      >
        <div>
          <h2 className="font-semibold text-gray-900">
            Zoom {source.connected && <span className="text-gray-400 font-normal">({source.meetings.length})</span>}
          </h2>
          <p className="text-xs text-gray-500">
            {!source.connected
              ? 'Not connected — add your Zoom app credentials in Settings.'
              : `Cloud recordings of ${source.userEmail}, last ${days} days. Zoom gives no attendee list, so each ` +
                'is matched to a meeting by start time (within 10 min), or by Zoom meeting number when the invite has the link.' +
                (unmatched ? ` ${unmatched} matched no meeting.` : '')}
          </p>
        </div>
        <span className="text-gray-400 text-sm">{open ? '▾' : '▸'}</span>
      </button>
      {open && source.connected && (
        <>
          {source.error && <div className="mx-5 mb-3 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{source.error}</div>}
          {!source.error && source.meetings.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-gray-500">No cloud recordings in this window.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium w-44">Recorded</th>
                  <th className="px-4 py-2 font-medium">Topic</th>
                  <th className="px-4 py-2 font-medium w-20">Length</th>
                  <th className="px-4 py-2 font-medium">Calendar meeting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {source.meetings.map((r: Recording) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{when(r.start, timezone)}</td>
                    <td className="px-4 py-2 text-gray-900">
                      {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.title}</a> : r.title}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{r.durationMin ? `${r.durationMin} min` : '—'}</td>
                    <td className="px-4 py-2">
                      {r.matchedMeeting ? (
                        <>
                          <span className="text-gray-900">{r.matchedMeeting.title}</span>
                          <span className="text-gray-400"> · {when(r.matchedMeeting.start, timezone)}</span>
                          <div className="text-xs text-gray-500">{matchNote(r.matchedMeeting.how, r.matchedMeeting.deltaMinutes)}</div>
                        </>
                      ) : (
                        <span className="text-amber-700">No calendar meeting with other attendees at that time</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Meetings from Avoma and Gong for the last few days, and the meetings on your
 * calendar that had other people in them but no recording in either.
 */
export function RecordingsPage() {
  const [days, setDays] = useState(7);
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [showRecorded, setShowRecorded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    setSteps([]);
    setStartedAt(Date.now());
    const progressId = crypto.randomUUID();
    let finished = false;
    const poll = setInterval(async () => {
      try {
        const p = await api.progress(progressId);
        if (!finished) setSteps(p.steps);
      } catch {
        // Progress is best-effort.
      }
    }, 1500);
    try {
      setData(await api.recordings({ days, scope, refresh }, progressId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finished = true;
      clearInterval(poll);
      setLoading(false);
    }
  }, [days, scope]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Ignoring updates the page in place; the server stores the choice.
  const byNewest = (a: AttendedMeeting, b: AttendedMeeting) => b.start.localeCompare(a.start);
  const matchesRule = (m: AttendedMeeting, rule: IgnoreRule) =>
    rule.kind === 'series'
      ? m.recurringEventId === rule.value
      : m.title.trim().toLowerCase().replace(/\s+/g, ' ') === rule.value;

  const ignore = async (meeting: AttendedMeeting, always: boolean) => {
    if (!data) return;
    setBusyId(meeting.id);
    setError(null);
    try {
      const { rule } = await api.ignoreMeeting({
        eventId: meeting.id,
        title: meeting.title,
        start: meeting.start,
        recurringEventId: meeting.recurringEventId,
        always,
      });
      const at = new Date().toISOString();
      setData(d => {
        if (!d) return d;
        const moving = d.calendar.unrecorded.filter(m => (rule ? matchesRule(m, rule) : m.id === meeting.id));
        const ids = new Set(moving.map(m => m.id));
        const tagged = moving.map(m => ({
          ...m,
          ignored: rule ? { kind: 'always' as const, ruleId: rule.id, at } : { kind: 'once' as const, at },
        }));
        return {
          ...d,
          calendar: {
            ...d.calendar,
            unrecorded: d.calendar.unrecorded.filter(m => !ids.has(m.id)),
            ignored: [...d.calendar.ignored, ...tagged].sort(byNewest),
          },
          ignoreRules: rule && !d.ignoreRules.some(r => r.id === rule.id) ? [...d.ignoreRules, rule] : d.ignoreRules,
        };
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  // Stop ignoring one meeting, or remove an "always" rule (which brings back
  // every meeting it covered).
  const restore = async (meeting: AttendedMeeting) => {
    if (!data || !meeting.ignored) return;
    const rule = meeting.ignored.kind === 'always'
      ? data.ignoreRules.find(r => r.id === meeting.ignored!.ruleId)
      : undefined;
    if (rule) {
      await removeRule(rule);
      return;
    }
    setBusyId(meeting.id);
    setError(null);
    try {
      await api.unignoreMeeting(meeting.id);
      setData(d => d && {
        ...d,
        calendar: {
          ...d.calendar,
          unrecorded: [...d.calendar.unrecorded, { ...meeting, ignored: null }].sort(byNewest),
          ignored: d.calendar.ignored.filter(m => m.id !== meeting.id),
        },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const removeRule = async (rule: IgnoreRule) => {
    const covered = data?.calendar.ignored.filter(m => m.ignored?.ruleId === rule.id).length || 0;
    if (covered > 1 && !window.confirm(
      `Stop always ignoring ${ruleLabel(rule)}? ${covered} meetings in this window will be flagged again.`
    )) return;
    setBusyId(rule.id);
    setError(null);
    try {
      await api.removeIgnoreRule(rule.id);
      setData(d => {
        if (!d) return d;
        const back = d.calendar.ignored.filter(m => m.ignored?.ruleId === rule.id);
        const ids = new Set(back.map(m => m.id));
        return {
          ...d,
          calendar: {
            ...d.calendar,
            unrecorded: [...d.calendar.unrecorded, ...back.map(m => ({ ...m, ignored: null }))].sort(byNewest),
            ignored: d.calendar.ignored.filter(m => !ids.has(m.id)),
          },
          ignoreRules: d.ignoreRules.filter(r => r.id !== rule.id),
        };
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const tz = data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nothingConnected = data && !data.avoma.connected && !data.gong.connected && !data.zoom.connected;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recordings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Meetings recorded in Avoma, Gong and Zoom, and the meetings on your calendar that had
            people in them but no recording.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            disabled={loading}
          >
            {[7, 14, 30].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <select
            className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
            value={scope}
            onChange={e => setScope(e.target.value as 'me' | 'all')}
            disabled={loading}
            title="Which Avoma and Gong recordings to list"
          >
            <option value="me">Recordings I was in</option>
            <option value="all">Everything my keys can see</option>
          </select>
          <Button variant="secondary" onClick={() => load(true)} disabled={loading}>Refresh</Button>
        </div>
      </div>

      <TodoReportPanel />

      {data && !loading && (
        <p className="text-xs text-gray-400">
          Recordings fetched at {new Date(data.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {' '}· kept for 5 minutes; Refresh re-reads Avoma and Gong.
        </p>
      )}

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <ProgressSteps steps={steps} startedAt={startedAt} idleLabel="Fetching recordings…" />
        </div>
      )}

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      {nothingConnected && (
        <div className="rounded-lg bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          You haven't connected Avoma, Gong or Zoom yet.{' '}
          <button className="underline" onClick={() => navigate('/settings')}>Add your API keys in Settings</button>.
        </div>
      )}

      {data && !loading && (
        <>
          {/* The question that matters most: what wasn't recorded. */}
          <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3">
              <h2 className="font-semibold text-gray-900">
                Meetings with no recording{' '}
                {data.calendar.connected && !data.calendar.error && (
                  <span className="text-gray-400 font-normal">
                    ({data.calendar.unrecorded.length} of {data.calendar.meetings.length})
                  </span>
                )}
              </h2>
              <p className="text-xs text-gray-500">
                Meetings on your calendar in the last {data.days} days that had other attendees, weren't
                declined, and have no recording: Avoma or Gong starting within 10 minutes with a shared attendee,
                or Zoom matched by time or meeting number.
              </p>
            </div>
            {!data.calendar.connected ? (
              <p className="px-5 pb-4 text-sm text-gray-500">
                Connect your Google Calendar (on Event types) to compare it with the recordings.
              </p>
            ) : data.calendar.error ? (
              <div className="mx-5 mb-4 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{data.calendar.error}</div>
            ) : nothingConnected ? (
              <p className="px-5 pb-4 text-sm text-gray-500">Connect Avoma, Gong or Zoom to check for recordings.</p>
            ) : data.calendar.unrecorded.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-emerald-700">
                {data.calendar.ignored.length
                  ? `Nothing left to look at — the other ${data.calendar.ignored.length} without a recording are ignored (below).`
                  : data.calendar.meetings.length
                    ? 'Every meeting with attendees has a recording.'
                    : 'No meetings with attendees in this window.'}
              </p>
            ) : (
              <MeetingsTable
                meetings={data.calendar.unrecorded}
                timezone={tz}
                actions={m => (
                  <div className="inline-flex gap-1">
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1 text-xs"
                      disabled={busyId === m.id}
                      onClick={() => ignore(m, false)}
                      title="Stop flagging this one meeting"
                    >
                      Ignore
                    </Button>
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1 text-xs"
                      disabled={busyId === m.id}
                      onClick={() => ignore(m, true)}
                      title={m.recurringEventId
                        ? 'Never flag any meeting in this recurring series'
                        : `Never flag any meeting titled "${m.title}"`}
                    >
                      Always ignore
                    </Button>
                  </div>
                )}
              />
            )}
            {(data.avoma.error || data.gong.error || data.zoom.error) && data.calendar.unrecorded.length > 0 && (
              <p className="px-5 py-2 text-xs text-amber-700 border-t border-gray-100">
                {[data.avoma.error && 'Avoma', data.gong.error && 'Gong', data.zoom.error && 'Zoom'].filter(Boolean).join(' and ')}
                {' '}could not be read, so some of these may have a recording there.
              </p>
            )}
          </section>

          {data.calendar.connected && !data.calendar.error && data.calendar.meetings.length > data.calendar.unrecorded.length && (
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button
                className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-gray-50"
                onClick={() => setShowRecorded(s => !s)}
              >
                <h2 className="font-semibold text-gray-900">
                  Meetings with a recording{' '}
                  <span className="text-gray-400 font-normal">
                    ({data.calendar.meetings.length - data.calendar.unrecorded.length})
                  </span>
                </h2>
                <span className="text-gray-400 text-sm">{showRecorded ? '▾' : '▸'}</span>
              </button>
              {showRecorded && (
                <MeetingsTable
                  meetings={data.calendar.meetings.filter(m => m.recordings.length)}
                  timezone={tz}
                  showRecordings
                />
              )}
            </section>
          )}

          <RecordingsTable label="Avoma" source={data.avoma} data={data} timezone={tz} />
          <RecordingsTable label="Gong" source={data.gong} data={data} timezone={tz} />
          <ZoomTable source={data.zoom} timezone={tz} days={data.days} />

          {(data.calendar.ignored.length > 0 || data.ignoreRules.length > 0) && (
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3">
                <h2 className="font-semibold text-gray-900">
                  Ignored meetings <span className="text-gray-400 font-normal">({data.calendar.ignored.length})</span>
                </h2>
                <p className="text-xs text-gray-500">
                  Meetings without a recording that you've chosen not to be told about. Restore one to flag it again.
                </p>
              </div>
              {data.calendar.ignored.length > 0 && (
                <MeetingsTable
                  meetings={data.calendar.ignored}
                  timezone={tz}
                  actions={m => {
                    const rule = m.ignored?.kind === 'always'
                      ? data.ignoreRules.find(r => r.id === m.ignored?.ruleId)
                      : undefined;
                    return (
                      <div className="inline-flex items-center gap-2">
                        <span className="text-xs text-gray-400">
                          {rule ? `Always — ${ruleLabel(rule)}` : 'Ignored'}
                        </span>
                        <Button
                          variant="ghost"
                          className="!px-2 !py-1 text-xs"
                          disabled={busyId === m.id || (!!rule && busyId === rule.id)}
                          onClick={() => restore(m)}
                          title={rule ? 'Stop always ignoring these — brings back every meeting it covered' : 'Flag this meeting again'}
                        >
                          Restore
                        </Button>
                      </div>
                    );
                  }}
                />
              )}
              {data.ignoreRules.length > 0 && (
                <div className="px-5 py-3 border-t border-gray-100">
                  <div className="text-xs font-medium text-gray-700 mb-1">Always ignoring</div>
                  <ul className="space-y-1">
                    {data.ignoreRules.map(rule => (
                      <li key={rule.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-gray-600">{ruleLabel(rule)}</span>
                        <Button
                          variant="ghost"
                          className="!px-2 !py-1 text-xs"
                          disabled={busyId === rule.id}
                          onClick={() => removeRule(rule)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
