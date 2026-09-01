import { useMemo, useState } from 'react';
import type { CalendarEvent, CommitmentType, SlotDay } from '../../types';
import {
  dateKeyInZone,
  dateKeyRange,
  labelForDateKey,
  minuteLabel,
  minutesInZone,
  todayKeyInZone,
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
}

const HOUR_HEIGHT = 52; // px per hour
const DAYS_PER_PAGE = 7;

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
}: AvailabilityCalendarProps) {
  const tz = calendarWindow.timezone;
  const [pageOffset, setPageOffset] = useState(0);

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

  const dateKeys = dateKeyRange(tz, pageOffset * DAYS_PER_PAGE, DAYS_PER_PAGE);
  const todayKey = todayKeyInZone(tz);
  const lastPage = Math.max(0, Math.ceil((calendarWindow.weeks * 7) / DAYS_PER_PAGE) - 1);

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
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setPageOffset(p => Math.max(0, p - 1))} disabled={pageOffset === 0}>
            ← Earlier
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPageOffset(p => Math.min(lastPage, p + 1))}
            disabled={pageOffset >= lastPage}
          >
            Later →
          </Button>
        </div>
        <div className="text-xs text-gray-500">
          {days.length > 0 && `${openCount} open slot${openCount === 1 ? '' : 's'} this week · `}
          times in {tz}
        </div>
      </div>

      <div className="flex items-center gap-4 gap-y-2 mb-3 text-xs text-gray-600 flex-wrap">
        {days.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded bg-emerald-100 border border-emerald-400" />
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

      <div className="border border-gray-200 rounded-lg overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Column headers */}
          <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
            <div className="w-14 shrink-0" />
            {dateKeys.map(key => {
              const { weekday, day } = labelForDateKey(key);
              const isToday = key === todayKey;
              return (
                <div key={key} className={`flex-1 px-2 py-2 text-center border-l border-gray-200 ${isToday ? 'bg-blue-50' : ''}`}>
                  <div className={`text-xs font-medium ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>{weekday}</div>
                  <div className="text-xs text-gray-500">{day}</div>
                </div>
              );
            })}
          </div>

          {/* All-day row, only when something is there */}
          {dateKeys.some(key => allDayByDate.get(key)?.length) && (
            <div className="flex border-b border-gray-200 bg-white">
              <div className="w-14 shrink-0 px-1 py-1 text-[10px] text-gray-400 text-right">all-day</div>
              {dateKeys.map(key => (
                <div key={key} className="flex-1 border-l border-gray-200 p-1 space-y-1">
                  {(allDayByDate.get(key) || []).map(event => (
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

            {dateKeys.map(key => {
              const { meetings, open } = blocksFor(key);
              return (
                <div key={key} className="flex-1 relative border-l border-gray-200">
                  {hourMarks.map(minute => (
                    <div
                      key={minute}
                      className="absolute left-0 right-0 border-t border-gray-100"
                      style={{ top: yFor(minute) }}
                    />
                  ))}

                  {meetings.map(block => {
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

                  {open.map(block => (
                    <div
                      key={block.key}
                      className="absolute left-0.5 right-0.5 rounded bg-emerald-100 border border-emerald-400 px-1 overflow-hidden"
                      style={{ top: block.top, height: block.height }}
                      title={`Bookable · ${block.label}`}
                    >
                      <div className="text-[10px] font-medium text-emerald-800 truncate">{block.label}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
