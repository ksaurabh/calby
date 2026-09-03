import { useCallback, useEffect, useState } from 'react';
import type { PublicEventType, SlotDay } from '../../types';
import { api } from '../../utils/api';
import { browserTimezone, formatDateTime } from '../../utils/format';
import { Button } from '../common';
import { BookingScheduler } from './BookingScheduler';
import { DurationPicker } from './DurationPicker';

interface Confirmation {
  start: string;
  end: string;
  timezone: string;
  name: string;
  email: string;
  eventTypeName: string;
  ownerName: string;
  cancelUrl: string;
  rescheduleUrl: string;
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/**
 * The public booking page, addressed only by the 16-character slug in the URL.
 * Deliberately renders before any auth check — visitors never sign in.
 */
export function BookingPage({ slug }: { slug: string }) {
  const [eventType, setEventType] = useState<PublicEventType | null>(null);
  const [days, setDays] = useState<SlotDay[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState<'pick' | 'details'>('pick');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerTz, setViewerTz] = useState(browserTimezone());
  const [duration, setDuration] = useState<number | null>(null);

  const load = useCallback(async (durationMinutes?: number) => {
    try {
      const data = await api.bookingPage(slug, durationMinutes);
      setEventType(data.eventType);
      setDays(data.days);
      setDuration(data.eventType.durationMinutes);
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

  // Changing the length re-asks the server: slot boundaries differ per duration.
  const changeDuration = async (minutes: number) => {
    setDuration(minutes);
    setSelected(null);
    setLoading(true);
    await load(minutes);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.book(slug, {
        start: selected,
        name: name.trim(),
        email: email.trim(),
        notes: notes.trim(),
        durationMinutes: duration || eventType!.durationMinutes,
      });
      setConfirmation(result.booking);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      // A 409 means someone else took the slot; refresh what's on offer.
      if ((err as Error).message.toLowerCase().includes('just taken')) {
        setSelected(null);
        setStep('pick');
        load(duration || undefined);
      }
    }
  };

  // 20% wider than the old max-w-4xl (56rem), and the picker inside is twice
  // as tall — see BookingScheduler.
  const shell = (children: React.ReactNode, width = 'max-w-[67rem]') => (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 px-4 py-10">
      <div className={`${width} mx-auto`}>{children}</div>
    </div>
  );

  if (loading && !eventType) {
    return shell(
      <div className="bg-white rounded-xl shadow-lg p-10 text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Checking the calendar…</p>
      </div>,
      'max-w-md'
    );
  }

  if (!eventType) {
    return shell(
      <div className="bg-white rounded-xl shadow-lg p-10 text-center">
        <div className="text-4xl mb-3">🔗</div>
        <h1 className="text-xl font-bold text-gray-900">This booking link isn’t available</h1>
        <p className="mt-2 text-gray-600">{error || 'The link may have been paused or deleted.'}</p>
      </div>,
      'max-w-md'
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
        <p className="mt-4 text-sm text-gray-500">
          Need to change it?{' '}
          <a href={confirmation.rescheduleUrl} className="text-blue-600 hover:text-blue-800">Reschedule</a>
          {' · '}
          <a href={confirmation.cancelUrl} className="text-blue-600 hover:text-blue-800">Cancel</a>
          <br />
          <span className="text-xs">These links are in your calendar invitation too.</span>
        </p>
      </div>,
      'max-w-md'
    );
  }

  const activeDuration = duration || eventType.durationMinutes;

  // Left rail: who, what, how long — mirrored on both steps.
  const details = (
    <div className="md:w-72 md:border-r md:border-gray-100 md:pr-6 shrink-0">
      <p className="text-sm text-gray-500">{eventType.ownerName}</p>
      <h1 className="text-xl font-bold text-gray-900 mt-1">{eventType.name}</h1>
      <div className="mt-3 text-sm text-gray-600">⏱ {durationLabel(activeDuration)}</div>
      {step === 'details' && selected && (
        <div className="mt-2 text-sm text-blue-700 font-medium">
          🗓 {formatDateTime(selected, viewerTz)}
        </div>
      )}
      {eventType.description && (
        <p className="mt-4 text-sm text-gray-600 whitespace-pre-line">{eventType.description}</p>
      )}
      {eventType.availabilitySummary && (
        <p className="mt-3 text-xs text-gray-500">{eventType.availabilitySummary}</p>
      )}
      {step === 'pick' && eventType.durationOptions.length > 1 && (
        <div className="mt-5">
          <DurationPicker
            options={eventType.durationOptions}
            value={activeDuration}
            onChange={changeDuration}
          />
        </div>
      )}
    </div>
  );

  return shell(
    <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
      {error && <div className="mb-5 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <div className="flex flex-col md:flex-row gap-6">
        {details}

        <div className="flex-1 min-w-0">
          {step === 'pick' ? (
            loading ? (
              <div className="py-16 text-center text-gray-500">Loading times…</div>
            ) : (
              <BookingScheduler
                days={days}
                timezone={viewerTz}
                onTimezoneChange={setViewerTz}
                hostTimezone={eventType.timezone}
                selected={selected}
                onSelect={setSelected}
                action={
                  <Button className="w-full" onClick={() => setStep('details')}>Next</Button>
                }
              />
            )
          ) : (
            <form onSubmit={submit} className="space-y-3 max-w-md">
              <h2 className="font-medium text-gray-900">Enter Details</h2>
              <input
                className={inputClass}
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                autoFocus
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
                className={`${inputClass} min-h-24`}
                placeholder="Anything to share before the meeting? (optional)"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={() => setStep('pick')}>Back</Button>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Scheduling…' : 'Schedule Event'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
