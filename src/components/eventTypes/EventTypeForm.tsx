import { useMemo, useState } from 'react';
import type { Colleague, CommitmentType, EventType, MeetingLocation } from '../../types';
import { browserTimezone } from '../../utils/format';
import { Button } from '../common';

interface EventTypeFormProps {
  eventType?: EventType;
  /** Prefill from eventType but create a new one (cloning). */
  asNew?: boolean;
  commitmentTypes: CommitmentType[];
  colleagues: Colleague[];
  zoomConnected: boolean;
  onSubmit: (values: {
    name: string;
    externalName: string;
    description: string;
    guidance: string;
    timezone: string;
    bookOverCommitmentTypeIds: string[];
    colleagueEmails: string[];
    meetingLocation: MeetingLocation;
  }) => Promise<void>;
  onCancel: () => void;
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

const EXAMPLES = [
  '30 minute intro calls, weekdays 9am–5pm, next 2 weeks',
  '60 minute deep dives, Tuesday and Thursday afternoons only, 24 hours notice',
  'Half hour syncs, mornings, no Fridays, 15 minute gap between calls',
];

export function EventTypeForm({ eventType, asNew = false, commitmentTypes, colleagues, zoomConnected, onSubmit, onCancel }: EventTypeFormProps) {
  const [name, setName] = useState(eventType?.name || '');
  const [externalName, setExternalName] = useState(eventType?.externalName || '');
  const [description, setDescription] = useState(eventType?.description || '');
  const [guidance, setGuidance] = useState(eventType?.guidance || '');
  const [bookOver, setBookOver] = useState<string[]>(eventType?.bookOverCommitmentTypeIds || []);
  const [withColleagues, setWithColleagues] = useState<string[]>(eventType?.colleagueEmails || []);
  const [meetingLocation, setMeetingLocation] = useState<MeetingLocation>(eventType?.meetingLocation || 'none');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        // Blank external name means "same as internal".
        externalName: externalName.trim() || name.trim(),
        description: description.trim(),
        guidance: guidance.trim(),
        timezone: eventType?.rules.timezone || browserTimezone(),
        bookOverCommitmentTypeIds: bookOver,
        colleagueEmails: withColleagues,
        meetingLocation,
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Internal name <span className="text-gray-400 font-normal">(only you see this)</span>
        </label>
        <input
          className={inputClass}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Inbound lead — 30m"
          required
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          External name <span className="text-gray-400 font-normal">(shown to whoever books)</span>
        </label>
        <input
          className={inputClass}
          value={externalName}
          onChange={e => setExternalName(e.target.value)}
          placeholder={name.trim() || 'Intro call'}
        />
        <p className="text-xs text-gray-500 mt-1">
          Appears on the booking page and in the calendar invite. Leave blank to use
          the internal name.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description <span className="text-gray-400 font-normal">(shown on the booking page)</span>
        </label>
        <input
          className={inputClass}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="A quick chat about what you're working on"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Where</label>
        <div className="flex gap-2">
          {([
            ['none', 'No location'],
            ['zoom', 'Zoom'],
          ] as [MeetingLocation, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMeetingLocation(value)}
              className={`px-3 py-1.5 rounded-lg border text-sm ${
                meetingLocation === value
                  ? 'border-blue-600 bg-blue-50 text-blue-800'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {value === 'zoom' && '📹 '}{label}
            </button>
          ))}
        </div>
        {meetingLocation === 'zoom' && (
          zoomConnected ? (
            <p className="text-xs text-gray-500 mt-1">
              Each booking gets its own Zoom meeting on your account, and the invite carries the join
              link, meeting ID, passcode and dial-in numbers. Rescheduling moves it; cancelling deletes it.
            </p>
          ) : (
            <p className="text-xs text-amber-700 mt-1">
              Connect Zoom on the <a href="/settings" className="underline">Settings</a> page first —
              Calby uses it to create each meeting.
            </p>
          )
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Availability guidance</label>
        <textarea
          className={`${inputClass} min-h-28`}
          value={guidance}
          onChange={e => setGuidance(e.target.value)}
          placeholder="Describe when people may book you, in plain English."
          required
        />
        <p className="text-xs text-gray-500 mt-2">
          Written in plain English — the scheduling agent reads this and works out the
          meeting length, days, hours and notice period, then checks your calendar for
          what is actually free.
        </p>
        <div className="mt-2 space-y-1">
          {EXAMPLES.map(example => (
            <button
              key={example}
              type="button"
              onClick={() => setGuidance(example)}
              className="block text-left text-xs text-blue-600 hover:text-blue-800"
            >
              “{example}”
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          OK to book over <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        {commitmentTypes.length === 0 ? (
          <p className="text-xs text-gray-500">
            No commitment types yet. Define some on the Commitment types page and you can
            let this event type be booked over them.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              {commitmentTypes.map(type => {
                const checked = bookOver.includes(type.id);
                return (
                  <label key={type.id} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() =>
                        setBookOver(current =>
                          checked ? current.filter(id => id !== type.id) : [...current, type.id]
                        )
                      }
                    />
                    <span
                      className="mt-1 w-3 h-3 rounded shrink-0 border"
                      style={{ backgroundColor: `${type.color}33`, borderColor: type.color }}
                    />
                    <span className="min-w-0">
                      <span className="text-sm text-gray-900">{type.name}</span>
                      <span className="block text-xs text-gray-500">{type.condition}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Time held by these commitments is still offered to people booking. Anything
              else on your calendar — including entries that haven't been classified —
              keeps blocking.
            </p>
          </>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Also check these colleagues{' '}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <ColleaguePicker colleagues={colleagues} selected={withColleagues} onChange={setWithColleagues} />
        <p className="text-xs text-gray-500 mt-2">
          A time is only offered when everyone added here is free as well. Calby reads
          their free/busy times only — never the titles of their meetings — the same
          way Google Calendar shows them to you.
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Reading your guidance…' : eventType && !asNew ? 'Save changes' : 'Create event type'}
        </Button>
      </div>
    </form>
  );
}

/** Type a few letters of a name or email to find a colleague on your domain. */
function ColleaguePicker({
  colleagues,
  selected,
  onChange,
}: {
  colleagues: Colleague[];
  selected: string[];
  onChange: (emails: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    return colleagues
      .filter(c => !selected.includes(c.email))
      .filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      .slice(0, 8);
  }, [colleagues, selected, q]);

  // A full address on your domain that isn't in the list can still be added.
  const domain = colleagues[0]?.email.split('@')[1];
  const typedEmail =
    /^[^\s@]+@[^\s@]+$/.test(q) &&
    !selected.includes(q) &&
    !matches.some(m => m.email === q)
      ? q
      : null;
  const options: { email: string; name: string; note?: string }[] = [
    ...matches,
    ...(typedEmail ? [{ email: typedEmail, name: typedEmail, note: 'Add this address' }] : []),
  ];

  const add = (email: string) => {
    onChange([...selected, email]);
    setQuery('');
    setActive(0);
  };
  const nameOf = (email: string) => colleagues.find(c => c.email === email)?.name || email;

  return (
    <div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(email => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 pl-2.5 pr-1 py-0.5 text-sm text-blue-900"
              title={email}
            >
              {nameOf(email)}
              <button
                type="button"
                className="rounded-full w-5 h-5 leading-none text-blue-500 hover:bg-blue-100 hover:text-blue-800"
                aria-label={`Remove ${nameOf(email)}`}
                onClick={() => onChange(selected.filter(e => e !== email))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          className={inputClass}
          placeholder={domain ? `Type a name or email (e.g. someone@${domain})` : 'Type a name or email'}
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (!options.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(i => (i + 1) % options.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(i => (i - 1 + options.length) % options.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              add(options[Math.min(active, options.length - 1)].email);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {open && q && (
          <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1">
            {options.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500">
                No one matches — type their full email address to add them.
              </li>
            ) : (
              options.map((o, i) => (
                <li
                  key={o.email}
                  className={`px-3 py-1.5 cursor-pointer ${i === active ? 'bg-blue-50' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={e => {
                    e.preventDefault();
                    add(o.email);
                  }}
                >
                  <span className="block text-sm text-gray-900">{o.note || o.name}</span>
                  <span className="block text-xs text-gray-500">{o.email}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
