/** Helpers for laying instants out on a week grid in a specific timezone. */

/** Minutes from local midnight for an instant, in the given timezone. */
export function minutesInZone(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/** "YYYY-MM-DD" for an instant, in the given timezone. */
export function dateKeyInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's date key in a timezone. */
export function todayKeyInZone(timeZone: string): string {
  return dateKeyInZone(new Date().toISOString(), timeZone);
}

/** `count` consecutive date keys starting `offsetDays` from today. */
export function dateKeyRange(timeZone: string, offsetDays: number, count: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.now() + (offsetDays + i) * 86400_000);
    keys.push(dateKeyInZone(at.toISOString(), timeZone));
  }
  return keys;
}

/** Offset between a timezone and UTC at an instant, in milliseconds. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return asUtc - date.getTime();
}

/**
 * The instant at which a local wall-clock time occurs in a timezone — the
 * inverse of minutesInZone. Two passes settle DST transitions.
 */
export function zonedTimeToUtc(dateKey: string, minutes: number, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  let ts = guess - tzOffsetMs(new Date(guess), timeZone);
  ts = guess - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** "Mon 12 Jan" style column header for a date key. */
export function labelForDateKey(key: string): { weekday: string; day: string } {
  // Parse as local noon so the label never slips a day across timezones.
  const [y, m, d] = key.split('-').map(Number);
  const at = new Date(y, m - 1, d, 12);
  return {
    weekday: at.toLocaleDateString(undefined, { weekday: 'short' }),
    day: at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  };
}

/** "9am", "1:30pm" for minutes from midnight. */
export function minuteLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour12}:${String(m).padStart(2, '0')}${suffix}` : `${hour12}${suffix}`;
}
