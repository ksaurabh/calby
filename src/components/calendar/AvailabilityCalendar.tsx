import { useMemo, useState } from 'react';
import type { CalendarEvent, CommitmentType, SlotDay } from '../../types';
import {
  dateKeyInZone,
  dateKeyRange,
  labelForDateKey,
  minuteLabel,
  minutesInZone,
  todayKeyInZone,
  zonedTimeToUtc,
} from '../../utils/calendar';
import { Button } from '../common';

/** The span the grid covers, independent of any one event type. */
export interface CalendarWindow {
  timezone: string;
  /** Default vertical range, widened to fit any meeting outside it. */
  startMinute: number;
  endMinute: number;
  /** How many weeks of paging to allow. */
  weeks: number;
}

interface AvailabilityCalendarProps {
  /** Bookable slots. Omit to show the calendar on its own. */
  days?: SlotDay[];
  events: CalendarEvent[];
  window: CalendarWindow;
  /** Colours entries whose commitment condition they satisfy. */
  commitmentTypes?: CommitmentType[];
  /** When given, meeting blocks become clickable. */
  onSelectEvent?: (event: CalendarEvent) => void;
  /**
   * Paging and width can be driven from outside, so two calendars shown side by
   * side stay on the same days. Left uncontrolled, the calendar manages its own.
   */
  daysPerPage?: number;
  onDaysPerPageChange?: (days: number) => void;
  pageOffset?: number;
  onPageOffsetChange?: (offset: number) => void;
  /** Hide the toolbar when a parent renders a shared one. */
  showControls?: boolean;
  /** Render only the toolbar — for driving two calendars from one control row. */
  controlsOnly?: boolean;
  /**
   * Keep the events for sizing the time axis but don't paint them. Two
   * calendars given the same events then agree on their vertical range, so 9am
   * on one lines up with 9am on the other.
   */
  hideEvents?: boolean;
  /** Let a parent own the scrolling, so one scrollbar can drive both halves. */
  scrollable?: boolean;
  /** Hide the legend when a parent renders a shared one. */
  showLegend?: boolean;
  /**
   * Show each day twice — the existing schedule, then the open slots — so the
   * two sit next to each other on one time axis: Mon booked, Mon open, Tue
   * booked, Tue open.
   */
  paired?: boolean;
  /**
   * Click anywhere in an open-slots column — including empty time — to ask about
   * that moment. Times are snapped to `snapMinutes`.
   */
  onPickTime?: (startIso: string) => void;
  snapMinutes?: number;
  /** Highlight the time currently being asked about. */
  selectedTime?: string | null;
}

const HOUR_HEIGHT = 52; // px per hour
const DAY_OPTIONS = [1, 2, 3, 4, 7];

interface Block {
  key: string;
  top: number;
  height: number;
  label: string;
  sublabel?: string;
  /** Commitment type colour, when the entry matched one. */
  color?: string;
  typeName?: string;
  event?: CalendarEvent;
}

/** Unmatched entries keep the neutral grey. */
const NEUTRAL = { bg: '#e5e7eb', border: '#d1d5db', text: '#374151' };

function blockStyle(color?: string) {
  if (!color) {
    return { backgroundColor: NEUTRAL.bg, borderColor: NEUTRAL.border, color: NEUTRAL.text };
  }
  // Hex + alpha keeps the fill light enough for the label to stay readable.
  return { backgroundColor: `${color}26`, borderColor: color, color };
}

/**
 * A week view in the event type's own timezone: existing meetings in grey,
 * bookable slots in green, so the owner can see what the guidance actually
 * opened up against what their calendar already holds.
 */
export function AvailabilityCalendar({
  days = [],
  events,
  window: calendarWindow,
  commitmentTypes = [],
  onSelectEvent,
  daysPerPage: controlledDaysPerPage,
  onDaysPerPageChange,
  pageOffset: controlledOffset,
  onPageOffsetChange,
  showControls = true,
  controlsOnly = false,
  hideEvents = false,
  scrollable = true,
  showLegend = true,
  paired = false,
  onPickTime,
  snapMinutes = 30,
  selectedTime = null,
}: AvailabilityCalendarProps) {
  const tz = calendarWindow.timezone;
  const [ownOffset, setOwnOffset] = useState(0);
  const [ownDaysPerPage, setOwnDaysPerPage] = useState(7);

  const daysPerPage = controlledDaysPerPage ?? ownDaysPerPage;
  const pageOffset = controlledOffset ?? ownOffset;
  const setPageOffset = (next: number) =>
    onPageOffsetChange ? onPageOffsetChange(next) : setOwnOffset(next);
  const setDaysPerPage = (next: number) => {
    // Keep the leftmost day fixed when the width changes, so the view doesn't jump.
    const firstDay = pageOffset * daysPerPage;
    const nextOffset = Math.floor(firstDay / next);
    if (onDaysPerPageChange) onDaysPerPageChange(next);
    else setOwnDaysPerPage(next);
    setPageOffset(nextOffset);
  };

  const typeById = useMemo(
    () => new Map(commitmentTypes.map(t => [t.id, t])),
    [commitmentTypes]
  );

  const slotsByDate = useMemo(() => {
    const map = new Map<string, SlotDay['slots']>();
    for (const day of days) map.set(day.date, day.slots);
    return map;
  }, [days]);

  // Timed events, split per local day so a meeting spanning midnight renders in
  // both columns. All-day events are listed separately above the grid.
  const timedByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      if (event.allDay) continue;
      const key = dateKeyInZone(event.start, tz);
      map.set(key, [...(map.get(key) || []), event]);
      const endKey = dateKeyInZone(event.end, tz);
      if (endKey !== key) map.set(endKey, [...(map.get(endKey) || []), event]);
    }
    return map;
  }, [events, tz]);

  const allDayByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      if (!event.allDay) continue;
      const key = event.start.slice(0, 10);
      map.set(key, [...(map.get(key) || []), event]);
    }
    return map;
  }, [events]);

  const dateKeys = dateKeyRange(tz, pageOffset * daysPerPage, daysPerPage);
  const todayKey = todayKeyInZone(tz);
  const lastPage = Math.max(0, Math.ceil((calendarWindow.weeks * 7) / daysPerPage) - 1);

  // Vertical range: the bookable window, widened to include any meeting that
  // falls outside it, so nothing on the calendar is silently cropped.
  const { fromMinute, toMinute } = useMemo(() => {
    let from = calendarWindow.startMinute;
    let to = calendarWindow.endMinute;
    for (const key of dateKeys) {
      for (const event of timedByDate.get(key) || []) {
        const startsToday = dateKeyInZone(event.start, tz) === key;
        const endsToday = dateKeyInZone(event.end, tz) === key;
        from = Math.min(from, startsToday ? minutesInZone(event.start, tz) : 0);
        to = Math.max(to, endsToday ? minutesInZone(event.end, tz) : 24 * 60);
      }
    }
    return {
      fromMinute: Math.max(0, Math.floor(from / 60) * 60),
      toMinute: Math.min(24 * 60, Math.ceil(to / 60) * 60),
    };
  }, [dateKeys, timedByDate, calendarWindow.startMinute, calendarWindow.endMinute, tz]);

  const totalMinutes = Math.max(60, toMinute - fromMinute);
  const gridHeight = (totalMinutes / 60) * HOUR_HEIGHT;
  const yFor = (minute: number) => ((minute - fromMinute) / 60) * HOUR_HEIGHT;

  const hourMarks: number[] = [];
  for (let m = fromMinute; m <= toMinute; m += 60) hourMarks.push(m);

  // A click in a slots column becomes a wall-clock time on that day.
  const pickTimeAt = (dateKey: string, event: React.MouseEvent<HTMLDivElement>) => {
    if (!onPickTime) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    const raw = fromMinute + ratio * totalMinutes;
    const snapped = Math.round(raw / snapMinutes) * snapMinutes;
    onPickTime(zonedTimeToUtc(dateKey, snapped, tz).toISOString());
  };

  // What each rendered column is: a day, and which layer it shows.
  const columns: { key: string; kind: 'both' | 'events' | 'slots'; first: boolean }[] = paired
    ? dateKeys.flatMap(key => [
        { key, kind: 'events' as const, first: true },
        { key, kind: 'slots' as const, first: false },
      ])
    : dateKeys.map(key => ({ key, kind: 'both' as const, first: true }));

  const blocksFor = (key: string) => {
    const meetings: Block[] = (timedByDate.get(key) || []).map(event => {
      const startsToday = dateKeyInZone(event.start, tz) === key;
      const endsToday = dateKeyInZone(event.end, tz) === key;
      const startMin = startsToday ? minutesInZone(event.start, tz) : 0;
      const endMin = endsToday ? minutesInZone(event.end, tz) : 24 * 60;
      const type = event.commitmentTypeId ? typeById.get(event.commitmentTypeId) : undefined;
      return {
        key: `${event.id}-${key}`,
        top: yFor(startMin),
        height: Math.max(14, ((endMin - startMin) / 60) * HOUR_HEIGHT),
        label: event.summary,
        sublabel: minuteLabel(startMin),
        color: type?.color,
        typeName: type?.name,
        event,
      };
    });

    const open: Block[] = (slotsByDate.get(key) || []).map(slot => {
      const startMin = minutesInZone(slot.start, tz);
      const endMin = minutesInZone(slot.end, tz);
      return {
        key: slot.start,
        top: yFor(startMin),
        height: Math.max(14, ((endMin - startMin) / 60) * HOUR_HEIGHT),
        label: minuteLabel(startMin),
      };
    });

    return { meetings, open };
  };

  const openCount = dateKeys.reduce((sum, key) => sum + (slotsByDate.get(key)?.length || 0), 0);

  return (
    <div>
      {showControls && (
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setPageOffset(Math.max(0, pageOffset - 1))}
              disabled={pageOffset === 0}
            >
              ← Earlier
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPageOffset(Math.min(lastPage, pageOffset + 1))}
              disabled={pageOffset >= lastPage}
            >
              Later →
            </Button>

            <div className="flex gap-1 ml-2">
              {DAY_OPTIONS.map(option => (
                <button
                  key={option}
                  onClick={() => setDaysPerPage(option)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                    daysPerPage === option
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-300 text-gray-600 hover:border-gray-500'
                  }`}
                >
                  {option === 7 ? 'Week' : `${option}d`}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-gray-500">
            {days.length > 0 &&
              `${openCount} open slot${openCount === 1 ? '' : 's'} shown · `}
            times in {tz}
          </div>
        </div>
      )}

      {showLegend && (
      <div className="flex items-center gap-4 gap-y-2 mb-3 text-xs text-gray-600 flex-wrap">
        {days.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded border border-dashed border-emerald-300 bg-emerald-50" />
            Bookable
          </span>
        )}
        {commitmentTypes.map(type => (
          <span key={type.id} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded border"
              style={{ backgroundColor: `${type.color}26`, borderColor: type.color }}
            />
            {type.name}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded border"
            style={{ backgroundColor: NEUTRAL.bg, borderColor: NEUTRAL.border }}
          />
          {commitmentTypes.length ? 'No commitment type' : 'Existing meeting'}
        </span>
      </div>
      )}

      {!controlsOnly && (
      <div className={`border border-gray-200 rounded-lg ${scrollable ? 'overflow-x-auto' : ''}`}>
        <div style={{ minWidth: Math.max(280, 90 * columns.length + 56) }}>
          {/* Column headers */}
          <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
            <div className="flex">
              <div className="w-14 shrink-0" />
              {dateKeys.map(key => {
                const { weekday, day } = labelForDateKey(key);
                const isToday = key === todayKey;
                return (
                  <div
                    key={key}
                    className={`px-2 pt-2 ${paired ? 'pb-0' : 'pb-2'} text-center border-l-2 border-gray-200 ${isToday ? 'bg-blue-50' : ''}`}
                    style={{ flex: paired ? 2 : 1 }}
                  >
                    <div className={`text-xs font-medium ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>{weekday}</div>
                    <div className="text-xs text-gray-500">{day}</div>
                  </div>
                );
              })}
            </div>

            {paired && (
              <div className="flex">
                <div className="w-14 shrink-0" />
                {columns.map((column, index) => (
                  <div
                    key={`${column.key}-${column.kind}-${index}`}
                    className={`flex-1 px-1 pb-1.5 text-center text-[10px] ${
                      column.first ? 'border-l-2' : 'border-l'
                    } border-gray-200 ${column.key === todayKey ? 'bg-blue-50' : ''} ${
                      column.kind === 'slots' ? 'text-emerald-700' : 'text-gray-500'
                    }`}
                  >
                    {column.kind === 'slots' ? 'Open slots' : 'Schedule'}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* All-day row, only when something is there */}
          {dateKeys.some(key => allDayByDate.get(key)?.length) && (
            <div className="flex border-b border-gray-200 bg-white">
              <div className="w-14 shrink-0 px-1 py-1 text-[10px] text-gray-400 text-right">all-day</div>
              {columns.map((column, index) => (
                <div
                  key={`${column.key}-${column.kind}-${index}`}
                  className={`flex-1 ${column.first ? 'border-l-2' : 'border-l'} border-gray-200 p-1 space-y-1`}
                >
                  {!hideEvents && column.kind !== 'slots' && (allDayByDate.get(column.key) || []).map(event => (
                    <div key={event.id} className="text-[10px] truncate rounded bg-gray-200 text-gray-700 px-1 py-0.5">
                      {event.summary}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Time grid */}
          <div className="flex" style={{ height: gridHeight }}>
            <div className="w-14 shrink-0 relative">
              {hourMarks.map(minute => (
                <div
                  key={minute}
                  className="absolute right-1 -translate-y-1/2 text-[10px] text-gray-400"
                  style={{ top: yFor(minute) }}
                >
                  {minuteLabel(minute)}
                </div>
              ))}
            </div>

            {columns.map((column, index) => {
              const { key, kind } = column;
              const { meetings, open } = blocksFor(key);
              const showMeetings = !hideEvents && kind !== 'slots';
              const showOpen = kind !== 'events';
              return (
                <div
                  key={`${key}-${kind}-${index}`}
                  onClick={onPickTime && kind !== 'events' ? e => pickTimeAt(key, e) : undefined}
                  className={`flex-1 relative ${column.first ? 'border-l-2' : 'border-l'} border-gray-200 ${
                    onPickTime && kind !== 'events' ? 'cursor-help' : ''
                  }`}
                  title={onPickTime && kind !== 'events' ? 'Click any time to ask why it is or is not open' : undefined}
                >
                  {hourMarks.map(minute => (
                    <div
                      key={minute}
                      className="absolute left-0 right-0 border-t border-gray-100"
                      style={{ top: yFor(minute) }}
                    />
                  ))}

                  {selectedTime && kind !== 'events' &&
                    dateKeyInZone(selectedTime, tz) === key && (
                      <div
                        className="absolute left-0 right-0 border-t-2 border-blue-600 z-10 pointer-events-none"
                        style={{ top: yFor(minutesInZone(selectedTime, tz)) }}
                      >
                        <span className="absolute -top-2 left-0 text-[9px] bg-blue-600 text-white px-1 rounded">
                          {minuteLabel(minutesInZone(selectedTime, tz))}
                        </span>
                      </div>
                    )}

                  {showOpen && open.map(block => (
                    <div
                      key={block.key}
                      className="absolute left-0.5 right-0.5 rounded border border-dashed border-emerald-300 bg-emerald-50/60 px-1 overflow-hidden"
                      style={{ top: block.top, height: block.height }}
                      title={`Bookable · ${block.label}`}
                    >
                      {block.height > 22 && (
                        <div className="text-[10px] text-emerald-700/70 truncate">{block.label}</div>
                      )}
                    </div>
                  ))}

                  {showMeetings && meetings.map(block => {
                    const clickable = !!onSelectEvent && !!block.event;
                    const Tag = clickable ? 'button' : 'div';
                    return (
                      <Tag
                        key={block.key}
                        onClick={clickable ? () => onSelectEvent!(block.event!) : undefined}
                        className={`absolute left-0.5 right-0.5 rounded border px-1 overflow-hidden text-left ${
                          clickable ? 'cursor-pointer hover:brightness-95' : ''
                        }`}
                        style={{ top: block.top, height: block.height, ...blockStyle(block.color) }}
                        title={[
                          block.label,
                          block.sublabel,
                          block.typeName && `· ${block.typeName}`,
                          clickable && '· click to explain',
                        ].filter(Boolean).join(' ')}
                      >
                        <div className="text-[10px] font-medium truncate">{block.label}</div>
                        {block.height > 28 && (
                          <div className="text-[10px] opacity-75 truncate">
                            {block.typeName || block.sublabel}
                          </div>
                        )}
                      </Tag>
                    );
                  })}

                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
