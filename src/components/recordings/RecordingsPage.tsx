import { useCallback, useEffect, useState } from 'react';
import type { AttendedMeeting, Recording, RecordingSource } from '../../types';
import { api } from '../../utils/api';
import { navigate } from '../../utils/navigate';
import { Button, ProgressSteps } from '../common';
import type { ProgressStep } from '../common/ProgressSteps';

type Data = Awaited<ReturnType<typeof api.recordings>>;

const SOURCE_STYLE: Record<'avoma' | 'gong', string> = {
  avoma: 'bg-violet-50 text-violet-700 border-violet-200',
  gong: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};
const SOURCE_LABEL = { avoma: 'Avoma', gong: 'Gong' };

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

function SourceBadge({ source }: { source: 'avoma' | 'gong' }) {
  return (
    <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded border ${SOURCE_STYLE[source]}`}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

function MeetingsTable({ meetings, timezone, showRecordings }: {
  meetings: AttendedMeeting[];
  timezone: string;
  showRecordings?: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <th className="px-4 py-2 font-medium w-44">When</th>
          <th className="px-4 py-2 font-medium">Meeting</th>
          <th className="px-4 py-2 font-medium">With</th>
          {showRecordings && <th className="px-4 py-2 font-medium">Recording</th>}
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
                  <a key={`${r.source}-${r.id}`} href={r.url} target="_blank" rel="noreferrer" title={r.title}>
                    <SourceBadge source={r.source} />
                  </a>
                ))}
              </td>
            )}
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
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-gray-50"
        onClick={() => setOpen(o => !o)}
      >
        <div>
          <h2 className="font-semibold text-gray-900">
            {label} {source.connected && <span className="text-gray-400 font-normal">({source.meetings.length})</span>}
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
          {!source.error && source.meetings.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-gray-500">No meetings in this window.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium w-44">When</th>
                  <th className="px-4 py-2 font-medium">Meeting</th>
                  <th className="px-4 py-2 font-medium">Attendees</th>
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

  const tz = data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nothingConnected = data && !data.avoma.connected && !data.gong.connected;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recordings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Meetings recorded in Avoma and Gong, and the meetings on your calendar that had people
            in them but no recording.
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

      {data && !loading && (
        <p className="text-xs text-gray-400 -mt-4">
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
          You haven't connected Avoma or Gong yet.{' '}
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
                declined, and have no Avoma or Gong recording starting within 10 minutes with a shared attendee.
              </p>
            </div>
            {!data.calendar.connected ? (
              <p className="px-5 pb-4 text-sm text-gray-500">
                Connect your Google Calendar (on Event types) to compare it with the recordings.
              </p>
            ) : data.calendar.error ? (
              <div className="mx-5 mb-4 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{data.calendar.error}</div>
            ) : nothingConnected ? (
              <p className="px-5 pb-4 text-sm text-gray-500">Connect Avoma or Gong to check for recordings.</p>
            ) : data.calendar.unrecorded.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-emerald-700">
                {data.calendar.meetings.length ? 'Every meeting with attendees has a recording.' : 'No meetings with attendees in this window.'}
              </p>
            ) : (
              <MeetingsTable meetings={data.calendar.unrecorded} timezone={tz} />
            )}
            {(data.avoma.error || data.gong.error) && data.calendar.unrecorded.length > 0 && (
              <p className="px-5 py-2 text-xs text-amber-700 border-t border-gray-100">
                {data.avoma.error ? 'Avoma' : 'Gong'} could not be read, so some of these may have a recording there.
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
        </>
      )}
    </div>
  );
}
