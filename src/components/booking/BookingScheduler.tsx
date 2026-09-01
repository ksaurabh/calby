import { useMemo, useState } from 'react';
import type { SlotDay } from '../../types';
import { dateKeyInZone } from '../../utils/calendar';
import { MonthCalendar } from './MonthCalendar';
import { TimezoneSelect } from './TimezoneSelect';

interface BookingSchedulerProps {
  days: SlotDay[];
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  hostTimezone?: string;
  selected: string | null;
  onSelect: (start: string) => void;
  /** Rendered under the chosen time — the "Next" step. */
  action?: React.ReactNode;
}

/**
 * The Calendly-shaped picker: a month on the left, that day's times on the
 * right. Slots arrive grouped by the host's day, so they are regrouped against
 * whichever timezone the visitor is reading in.
 */
export function BookingScheduler({
  days,
  timezone,
  onTimezoneChange,
  hostTimezone,
  selected,
  onSelect,
  action,
}: BookingSchedulerProps) {
  const byDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const day of days) {
      for (const slot of day.slots) {
        const key = dateKeyInZone(slot.start, timezone);
        map.set(key, [...(map.get(key) || []), slot.start]);
      }
    }
    for (const [, starts] of map) starts.sort();
    return map;
  }, [days, timezone]);

  const availableDates = useMemo(() => new Set(byDate.keys()), [byDate]);
  const firstDate = useMemo(() => [...availableDates].sort()[0] || null, [availableDates]);

  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [monthOverride, setMonthOverride] = useState<{ year: number; month: number } | null>(null);

  // Derived rather than synced: changing timezone or duration can remove the
  // day that was picked, and the first available day is the right fallback.
  const selectedDate = pickedDate && availableDates.has(pickedDate) ? pickedDate : firstDate;

  const visibleMonth = useMemo(() => {
    if (monthOverride) return monthOverride;
    const [y, m] = (selectedDate || new Date().toISOString().slice(0, 10)).split('-').map(Number);
    return { year: y, month: m };
  }, [monthOverride, selectedDate]);

  const times = selectedDate ? byDate.get(selectedDate) || [] : [];
  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone });
  const dayHeading = selectedDate
    ? (() => {
        const [y, m, d] = selectedDate.split('-').map(Number);
        return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, {
          weekday: 'long', month: 'long', day: 'numeric',
        });
      })()
    : '';

  if (!firstDate) {
    return <p className="text-gray-600">No open times right now. Please check back later.</p>;
  }

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <div className="md:flex-1 md:max-w-sm">
        <h2 className="font-medium text-gray-900 mb-4">Select a Date &amp; Time</h2>
        <MonthCalendar
          availableDates={availableDates}
          selectedDate={selectedDate}
          onSelect={setPickedDate}
          year={visibleMonth.year}
          month={visibleMonth.month}
          onMonthChange={(year, month) => setMonthOverride({ year, month })}
        />
        <div className="mt-5">
          <TimezoneSelect value={timezone} onChange={onTimezoneChange} hostTimezone={hostTimezone} />
        </div>
      </div>

      <div className="md:w-56 md:border-l md:border-gray-100 md:pl-6">
        <div className="text-sm font-medium text-gray-900 mb-3">{dayHeading}</div>
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {times.map(start => (
            <div key={start}>
              <button
                onClick={() => onSelect(start)}
                className={`w-full text-sm font-medium px-3 py-2.5 rounded-lg border transition-colors ${
                  selected === start
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-blue-200 text-blue-700 hover:border-blue-600'
                }`}
              >
                {timeLabel(start)}
              </button>
              {selected === start && action && <div className="mt-2">{action}</div>}
            </div>
          ))}
          {times.length === 0 && <p className="text-sm text-gray-500">No times on this day.</p>}
        </div>
      </div>
    </div>
  );
}
