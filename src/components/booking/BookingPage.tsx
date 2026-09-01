import { useCallback, useEffect, useState } from 'react';
import type { PublicEventType, SlotDay } from '../../types';
import { api } from '../../utils/api';
import { browserTimezone, formatDateTime, formatDayLabel, formatTime } from '../../utils/format';
import { Button } from '../common';

interface Confirmation {
  start: string;
  end: string;
  timezone: string;
  name: string;
  email: string;
  eventTypeName: string;
  ownerName: string;
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

/**
 * The public booking page, addressed only by the 16-character slug in the URL.
 * Deliberately renders before any auth check — visitors never sign in.
 */
export function BookingPage({ slug }: { slug: string }) {
  const [eventType, setEventType] = useState<PublicEventType | null>(null);
  const [days, setDays] = useState<SlotDay[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Times are shown in the visitor's own timezone; the host's is noted alongside.
  const viewerTz = browserTimezone();

  const load = useCallback(async () => {
    try {
      const data = await api.bookingPage(slug);
      setEventType(data.eventType);
      setDays(data.days);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.book(slug, { start: selected, name: name.trim(), email: email.trim(), notes: notes.trim() });
      setConfirmation(result.booking);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      // A 409 means someone else took the slot; refresh what's on offer.
      if ((err as Error).message.toLowerCase().includes('just taken')) {
        setSelected(null);
        load();
      }
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">{children}</div>
    </div>
  );

  if (loading) {
    return shell(
      <div className="bg-white rounded-xl shadow-lg p-10 text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Checking the calendar…</p>
      </div>
    );
  }

  if (!eventType) {
    return shell(
      <div className="bg-white rounded-xl shadow-lg p-10 text-center">
        <div className="text-4xl mb-3">🔗</div>
        <h1 className="text-xl font-bold text-gray-900">This booking link isn’t available</h1>
        <p className="mt-2 text-gray-600">{error || 'The link may have been paused or deleted.'}</p>
      </div>
    );
  }

  if (confirmation) {
    return shell(
      <div className="bg-white rounded-xl shadow-lg p-10 text-center">
        <div className="text-4xl mb-3">✅</div>
        <h1 className="text-xl font-bold text-gray-900">You’re booked</h1>
        <p className="mt-3 text-gray-700">
          {confirmation.eventTypeName} with {confirmation.ownerName}
        </p>
        <p className="mt-1 text-lg font-medium text-gray-900">
          {formatDateTime(confirmation.start, viewerTz)}
        </p>
        <p className="mt-1 text-sm text-gray-500">{viewerTz}</p>
        <p className="mt-4 text-sm text-gray-600">
          A calendar invitation is on its way to {confirmation.email}.
        </p>
      </div>
    );
  }

  return shell(
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      <div className="p-8 border-b border-gray-100">
        <p className="text-sm text-gray-500">{eventType.ownerName}</p>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{eventType.name}</h1>
        {eventType.description && <p className="mt-2 text-gray-600">{eventType.description}</p>}
        <div className="mt-3 flex flex-wrap gap-3 text-sm text-gray-500">
          <span>⏱ {eventType.durationMinutes} minutes</span>
          <span>🌐 Times shown in {viewerTz}</span>
        </div>
        {eventType.availabilitySummary && (
          <p className="mt-2 text-sm text-gray-500">{eventType.availabilitySummary}</p>
        )}
      </div>

      {error && <div className="mx-8 mt-6 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <div className="p-8">
        {days.length === 0 ? (
          <p className="text-gray-600">No open times right now. Please check back later.</p>
        ) : (
          <>
            <h2 className="font-medium text-gray-900 mb-3">Pick a time</h2>
            <div className="space-y-5 max-h-96 overflow-y-auto pr-1">
              {days.map(day => (
                <div key={day.date}>
                  <div className="text-sm font-medium text-gray-900">
                    {formatDayLabel(day.slots[0].start)}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {day.slots.map(slot => (
                      <button
                        key={slot.start}
                        onClick={() => setSelected(slot.start)}
                        className={`text-sm px-3 py-2 rounded-lg border transition-colors ${
                          selected === slot.start
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-gray-300 text-gray-700 hover:border-blue-500 hover:bg-blue-50'
                        }`}
                      >
                        {formatTime(slot.start)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {selected && (
              <form onSubmit={submit} className="mt-8 border-t border-gray-100 pt-6 space-y-3">
                <p className="text-sm text-gray-700">
                  Booking <span className="font-medium">{formatDateTime(selected, viewerTz)}</span>
                </p>
                <input
                  className={inputClass}
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
                <input
                  className={inputClass}
                  type="email"
                  placeholder="Your email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
                <textarea
                  className={`${inputClass} min-h-20`}
                  placeholder="Anything to share before the meeting? (optional)"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? 'Booking…' : 'Confirm booking'}
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
