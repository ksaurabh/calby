import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, CommitmentType, PublicEventType, SlotDay } from '../../types';
import { api } from '../../utils/api';
import { dateKeyInZone, todayKeyInZone, zonedTimeToUtc } from '../../utils/calendar';
import { browserTimezone } from '../../utils/format';
import { navigate } from '../../utils/navigate';
import { Button } from '../common';
import { BookingScheduler } from '../booking/BookingScheduler';
import { DurationPicker } from '../booking/DurationPicker';

interface Data {
  eventType: PublicEventType;
  active: boolean;
  slug: string;
  days: SlotDay[];
  events: CalendarEvent[];
  busy: { start: string; end: string }[];
  commitmentTypes: CommitmentType[];
  calendarFetchedAt: string;
}

const PX_PER_MIN = 1.1;

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function shiftDay(key: string, by: number) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + by));
  return date.toISOString().slice(0, 10);
}

function dayHeading(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

const hourLabel = (h: number) => {
  const hh = ((h + 11) % 12) + 1;
  return `${hh} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
};

interface Block {
  key: string;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  label: string;
  sub: string;
  color?: string;
  kind: 'event' | 'busy' | 'slot';
  start: string;
  title?: string;
}

/** Side-by-side lanes for blocks that overlap. */
function layLanes(blocks: Omit<Block, 'lane' | 'lanes'>[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.top - b.top || b.height - a.height);
  const out: Block[] = [];
  let group: Block[] = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...group.map(b => b.lane + 1));
    for (const b of group) out.push({ ...b, lanes });
    group = [];
  };
  for (const b of sorted) {
    if (b.top >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    const used = new Set(group.filter(g => g.top + g.height > b.top).map(g => g.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    group.push({ ...b, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, b.top + b.height);
  }
  flush();
  return out;
}

function Timeline({ day, timezone, data, selected, onSelect, durationMinutes }: {
  day: string;
  timezone: string;
  data: Data;
  selected: string | null;
  onSelect: (start: string) => void;
  durationMinutes: number;
}) {
  // For the "now" line; moves once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const dayStart = zonedTimeToUtc(day, 0, timezone).getTime();
  const dayEnd = zonedTimeToUtc(shiftDay(day, 1), 0, timezone).getTime();
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone });
  const typeById = new Map(data.commitmentTypes.map(t => [t.id, t]));

  const within = (startIso: string, endIso: string) => {
    const s = Math.max(Date.parse(startIso), dayStart);
    const e = Math.min(Date.parse(endIso), dayEnd);
    return e > s ? { s, e } : null;
  };

  const allDay = data.events.filter(e => e.allDay && within(e.start, e.end));
  const timed = data.events
    .filter(e => !e.allDay)
    .map(e => ({ e, r: within(e.start, e.end) }))
    .filter((x): x is { e: CalendarEvent; r: { s: number; e: number } } => !!x.r);
  // Busy time with no entry of yours behind it (other calendars, colleagues' holds…).
  const unexplained = data.busy
    .map(b => within(b.start, b.end))
    .filter((r): r is { s: number; e: number } => !!r)
    .filter(r => !timed.some(({ r: t }) => t.s <= r.s && t.e >= r.e));
  const slots = data.days
    .flatMap(d => d.slots)
    .filter(s => dateKeyInZone(s.start, timezone) === day)
    .map(s => ({ start: s.start, s: Date.parse(s.start), e: Date.parse(s.start) + durationMinutes * 60_000 }));

  // Show 7 AM–7 PM, widened to fit whatever is on the day.
  const mins = (ms: number) => (ms - dayStart) / 60_000;
  const points = [...timed.map(t => t.r), ...unexplained, ...slots];
  const firstHour = Math.max(0, Math.min(7, ...points.map(p => Math.floor(mins(p.s) / 60))));
  const lastHour = Math.min(24, Math.max(19, ...points.map(p => Math.ceil(mins(p.e) / 60))));
  const top = (ms: number) => (mins(ms) - firstHour * 60) * PX_PER_MIN;
  const height = (s: number, e: number) => Math.max(14, (e - s) / 60_000 * PX_PER_MIN);

  const calendarBlocks = layLanes([
    ...timed.map(({ e, r }) => {
      const type = e.commitmentTypeId ? typeById.get(e.commitmentTypeId) : undefined;
      return {
        key: `e-${e.id}`,
        top: top(r.s),
        height: height(r.s, r.e),
        label: e.summary || '(no title)',
        sub: `${time(Date.parse(e.start))} – ${time(Date.parse(e.end))}`,
        color: type?.color,
        title: type ? `${e.summary} · ${type.name}` : e.summary,
        kind: 'event' as const,
        start: e.start,
      };
    }),
    ...unexplained.map((r, i) => ({
      key: `b-${i}`,
      top: top(r.s),
      height: height(r.s, r.e),
      label: 'Busy',
      sub: `${time(r.s)} – ${time(r.e)}`,
      kind: 'busy' as const,
      start: new Date(r.s).toISOString(),
      title: 'Busy on a calendar Calby only sees as free/busy',
    })),
  ]);

  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  const totalHeight = (lastHour - firstHour) * 60 * PX_PER_MIN;

  return (
    <div>
      {allDay.length > 0 && (
        <div className="mb-2 space-y-1">
          {allDay.map(e => (
            <div key={e.id} className="text-xs rounded bg-gray-100 text-gray-700 px-2 py-1 truncate" title={e.summary}>
              All day · {e.summary}
            </div>
          ))}
        </div>
      )}
      <div className="flex text-[11px] text-gray-500 mb-1">
        <div className="w-12 shrink-0" />
        <div className="flex-1 px-1">Your calendar</div>
        <div className="w-24 shrink-0 px-1">Open slots ({slots.length})</div>
      </div>
      <div className="relative flex" style={{ height: totalHeight }}>
        <div className="w-12 shrink-0 relative">
          {hours.map(h => (
            <div
              key={h}
              className="absolute right-1 -translate-y-1/2 text-[10px] text-gray-400"
              style={{ top: (h - firstHour) * 60 * PX_PER_MIN }}
            >
              {h < 24 ? hourLabel(h) : ''}
            </div>
          ))}
        </div>
        <div className="flex-1 relative border-l border-gray-200">
          {hours.map(h => (
            <div key={h} className="absolute inset-x-0 border-t border-gray-100" style={{ top: (h - firstHour) * 60 * PX_PER_MIN }} />
          ))}
          {calendarBlocks.map(b => (
            <div
              key={b.key}
              title={b.title}
              className={`absolute rounded px-1.5 py-0.5 overflow-hidden text-[11px] leading-tight border ${
                b.kind === 'busy'
                  ? 'bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_4px,#e5e7eb_4px,#e5e7eb_8px)] border-gray-300 text-gray-600'
                  : 'bg-blue-50 border-blue-200 text-blue-900'
              }`}
              style={{
                top: b.top,
                height: b.height,
                left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
                width: `calc(${100 / b.lanes}% - 4px)`,
                ...(b.color ? { backgroundColor: `${b.color}22`, borderColor: b.color } : {}),
              }}
            >
              <div className="font-medium truncate">{b.label}</div>
              {b.height >= 26 && <div className="truncate opacity-75">{b.sub}</div>}
            </div>
          ))}
        </div>
        <div className="w-24 shrink-0 relative border-l border-gray-200">
          {hours.map(h => (
            <div key={h} className="absolute inset-x-0 border-t border-gray-100" style={{ top: (h - firstHour) * 60 * PX_PER_MIN }} />
          ))}
          {slots.map(s => (
            <button
              key={s.start}
              type="button"
              onClick={() => onSelect(s.start)}
              className={`absolute inset-x-1 rounded border text-[11px] text-left px-1.5 overflow-hidden ${
                selected === s.start
                  ? 'bg-blue-600 border-blue-600 text-white z-10'
                  : 'bg-green-50 border-green-300 text-green-800 hover:border-green-600'
              }`}
              style={{ top: top(s.s), height: height(s.s, s.e) }}
              title={`${time(s.s)} – ${time(s.e)}`}
            >
              {time(s.s)}
            </button>
          ))}
        </div>
        {now > dayStart && now < dayEnd && (
          <div className="absolute left-12 right-0 border-t-2 border-red-400 pointer-events-none" style={{ top: top(now) }} />
        )}
      </div>
      {slots.length === 0 && <p className="mt-2 text-xs text-gray-500">No open slots on this day.</p>}
    </div>
  );
}

/**
 * What the booking link shows a guest, with your calendar for the same day on
 * a timeline beside it. Fast: no AI, and the calendar comes from the recent
 * copy unless you refresh.
 */
export function QuickPreviewPage({ eventTypeId }: { eventTypeId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState<number | null>(null);
  const [viewerTz, setViewerTz] = useState(browserTimezone());
  const [selected, setSelected] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);

  const load = useCallback(async (opts: { durationMinutes?: number; refresh?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.quickPreview(eventTypeId, opts);
      setData(next);
      setDuration(next.eventType.durationMinutes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [eventTypeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const onDateChange = useCallback((date: string | null) => {
    if (date) setDay(date);
  }, []);

  const shownDay = day || todayKeyInZone(viewerTz);
  const activeDuration = duration || data?.eventType.durationMinutes || 30;
  const fetchedAt = useMemo(
    () => data && new Date(data.calendarFetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    [data]
  );

  if (!data) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-xl border border-gray-200 p-10 text-center">
        {error ? (
          <>
            <p className="text-red-700">{error}</p>
            <Button className="mt-4" variant="secondary" onClick={() => navigate('/')}>Back to event types</Button>
          </>
        ) : (
          <>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
            <p className="text-gray-600">Loading the preview…</p>
          </>
        )}
      </div>
    );
  }

  const { eventType } = data;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Button variant="ghost" onClick={() => navigate('/')}>← Event types</Button>
          <span className="text-gray-500">
            Quick preview of <span className="font-medium text-gray-900">{eventType.name}</span> — what guests see on the link
          </span>
          {!data.active && <span className="text-xs rounded bg-amber-50 text-amber-700 px-2 py-0.5">Paused: the link is off</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Calendar read at {fetchedAt}</span>
          <Button
            variant="secondary"
            className="!px-2 !py-1 text-xs"
            disabled={loading}
            onClick={() => load({ durationMinutes: activeDuration, refresh: true })}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          {data.active && (
            <a href={`/book/${data.slug}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
              Open the real link
            </a>
          )}
        </div>
      </div>
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}

      <div className="flex flex-col xl:flex-row gap-4 items-start">
        {/* What the guest sees */}
        <div className="flex-1 min-w-0 bg-white rounded-xl shadow-lg p-6">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="md:w-60 md:border-r md:border-gray-100 md:pr-6 shrink-0">
              <p className="text-sm text-gray-500">{eventType.ownerName}</p>
              <h1 className="text-xl font-bold text-gray-900 mt-1">{eventType.name}</h1>
              <div className="mt-3 text-sm text-gray-600">⏱ {durationLabel(activeDuration)}</div>
              {eventType.description && (
                <p className="mt-4 text-sm text-gray-600 whitespace-pre-line">{eventType.description}</p>
              )}
              {eventType.availabilitySummary && (
                <p className="mt-3 text-xs text-gray-500">{eventType.availabilitySummary}</p>
              )}
              {eventType.durationOptions.length > 1 && (
                <div className="mt-5">
                  <DurationPicker
                    options={eventType.durationOptions}
                    value={activeDuration}
                    onChange={minutes => {
                      setDuration(minutes);
                      setSelected(null);
                      load({ durationMinutes: minutes });
                    }}
                  />
                </div>
              )}
            </div>
            <div className={`flex-1 min-w-0 ${loading ? 'opacity-50' : ''}`}>
              <BookingScheduler
                days={data.days}
                timezone={viewerTz}
                onTimezoneChange={setViewerTz}
                hostTimezone={eventType.timezone}
                selected={selected}
                onSelect={setSelected}
                onDateChange={onDateChange}
                action={<p className="text-xs text-gray-500 text-center">Preview — booking is off here.</p>}
              />
            </div>
          </div>
        </div>

        {/* Your calendar for that day */}
        <aside className="w-full xl:w-[26rem] shrink-0 bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setDay(shiftDay(shownDay, -1))}>←</Button>
            <div className="text-sm font-medium text-gray-900">{dayHeading(shownDay)}</div>
            <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setDay(shiftDay(shownDay, 1))}>→</Button>
          </div>
          <Timeline
            day={shownDay}
            timezone={viewerTz}
            data={data}
            selected={selected}
            onSelect={start => {
              setSelected(start);
              setDay(dateKeyInZone(start, viewerTz));
            }}
            durationMinutes={activeDuration}
          />
          <p className="mt-3 text-[11px] text-gray-400">
            Times in {viewerTz}. Entries are coloured by commitment type; striped blocks are busy time with no entry
            Calby can see.
          </p>
        </aside>
      </div>
    </div>
  );
}
