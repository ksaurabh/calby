import { useMemo } from 'react';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');
const keyFor = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

interface MonthCalendarProps {
  /** Date keys ("YYYY-MM-DD") that have at least one open slot. */
  availableDates: Set<string>;
  selectedDate: string | null;
  onSelect: (date: string) => void;
  /** Visible month, as [year, month] with month 1-12. */
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
}

/**
 * Month grid where only days with open slots are selectable — everything else
 * is greyed out, so the shape of someone's availability is visible at a glance.
 */
export function MonthCalendar({
  availableDates,
  selectedDate,
  onSelect,
  year,
  month,
  onMonthChange,
}: MonthCalendarProps) {
  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const list: (number | null)[] = Array.from({ length: firstWeekday }, () => null);
    for (let day = 1; day <= daysInMonth; day++) list.push(day);
    return list;
  }, [year, month]);

  // Only allow paging to months that actually contain availability.
  const monthValue = year * 12 + (month - 1);
  const monthsWithSlots = useMemo(() => {
    const set = new Set<number>();
    for (const key of availableDates) {
      const [y, m] = key.split('-').map(Number);
      set.add(y * 12 + (m - 1));
    }
    return set;
  }, [availableDates]);
  const hasEarlier = [...monthsWithSlots].some(m => m < monthValue);
  const hasLater = [...monthsWithSlots].some(m => m > monthValue);

  const step = (delta: number) => {
    const next = monthValue + delta;
    onMonthChange(Math.floor(next / 12), (next % 12) + 1);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="font-medium text-gray-900">{MONTH_NAMES[month - 1]} {year}</div>
        <div className="flex gap-1">
          <button
            onClick={() => step(-1)}
            disabled={!hasEarlier}
            aria-label="Previous month"
            className="w-8 h-8 rounded-full text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ‹
          </button>
          <button
            onClick={() => step(1)}
            disabled={!hasLater}
            aria-label="Next month"
            className="w-8 h-8 rounded-full text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LABELS.map(label => (
          <div key={label} className="text-center text-xs font-medium text-gray-400 py-1">
            {label.slice(0, 3).toUpperCase()}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) return <div key={`pad-${index}`} />;
          const key = keyFor(year, month, day);
          const available = availableDates.has(key);
          const isSelected = key === selectedDate;

          return (
            <button
              key={key}
              onClick={() => available && onSelect(key)}
              disabled={!available}
              aria-label={`${day}${available ? ', times available' : ', unavailable'}`}
              aria-pressed={isSelected}
              className={`aspect-square rounded-full text-sm flex items-center justify-center transition-colors ${
                isSelected
                  ? 'bg-blue-600 text-white font-semibold'
                  : available
                    ? 'bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100'
                    : 'text-gray-300 cursor-default'
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
