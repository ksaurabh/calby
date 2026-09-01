import { useMemo } from 'react';
import { browserTimezone } from '../../utils/format';

/** A short list to fall back on where Intl.supportedValuesOf is unavailable. */
const FALLBACK_ZONES = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Paris',
  'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore',
  'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

function allZones(): string[] {
  try {
    const supported = (Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    }).supportedValuesOf?.('timeZone');
    if (supported?.length) return supported;
  } catch {
    // Older browsers — fall through to the short list.
  }
  return FALLBACK_ZONES;
}

/** "GMT-5" style offset label, for orienting people in the long list. */
function offsetLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

interface TimezoneSelectProps {
  value: string;
  onChange: (timezone: string) => void;
  /** The host's timezone, offered as a labelled shortcut. */
  hostTimezone?: string;
}

export function TimezoneSelect({ value, onChange, hostTimezone }: TimezoneSelectProps) {
  const browserTz = browserTimezone();

  // The two shortcuts people actually want sit at the top, then everything else.
  const { shortcuts, rest } = useMemo(() => {
    const pinned: { zone: string; label: string }[] = [
      { zone: browserTz, label: `${browserTz} — your current timezone` },
    ];
    if (hostTimezone && hostTimezone !== browserTz) {
      pinned.push({ zone: hostTimezone, label: `${hostTimezone} — the host's timezone` });
    }
    const pinnedZones = new Set(pinned.map(p => p.zone));
    return { shortcuts: pinned, rest: allZones().filter(z => !pinnedZones.has(z)) };
  }, [browserTz, hostTimezone]);

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600 shrink-0" htmlFor="timezone">🌐 Timezone</label>
      <select
        id="timezone"
        className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm max-w-full focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {shortcuts.map(({ zone, label }) => (
          <option key={`pinned-${zone}`} value={zone}>{label}</option>
        ))}
        <optgroup label="All timezones">
          {rest.map(zone => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, ' ')} {offsetLabel(zone) && `(${offsetLabel(zone)})`}
            </option>
          ))}
        </optgroup>
      </select>
      {value !== browserTz && (
        <button
          type="button"
          onClick={() => onChange(browserTz)}
          className="text-xs text-blue-600 hover:text-blue-800 shrink-0"
        >
          Use mine
        </button>
      )}
    </div>
  );
}
