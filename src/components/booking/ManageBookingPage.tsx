import { useCallback, useEffect, useState } from 'react';
import type { ManagedBooking, SlotDay } from '../../types';
import { api } from '../../utils/api';
import { browserTimezone, formatDateTime } from '../../utils/format';
import { Button } from '../common';
import { BookingScheduler } from './BookingScheduler';

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

/**
 * The page behind the Cancel and Reschedule links in the calendar invite.
 * Authorized purely by the token in the URL — guests have no account here.
 */
export function ManageBookingPage({ token, mode }: { token: string; mode: 'cancel' | 'reschedule' }) {
  const [booking, setBooking] = useState<ManagedBooking | null>(null);
  const [days, setDays] = useState<SlotDay[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<'cancelled' | 'rescheduled' | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewerTz, setViewerTz] = useState(browserTimezone());

  const load = useCallback(async () => {
    try {
      const data = await api.managedBooking(token);
      setBooking(data.booking);
      setDays(data.days);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.cancelBooking(token, reason.trim());
      setDone('cancelled');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const reschedule = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.rescheduleBooking(token, selected);
      setBooking(result.booking);
      setDone('rescheduled');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      if ((e as Error).message.toLowerCase().includes('no longer open')) {
        setSelected(null);
        load();
      }
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 px-4 py-10">
      <div className={`${mode === 'reschedule' ? 'max-w-4xl' : 'max-w-2xl'} mx-auto`}>{children}</div>
    </div>
  );

  const card = (children: React.ReactNode) => (
    <div className="bg-white rounded-xl shadow-lg p-8">{children}</div>
  );

  if (loading) {
    return shell(card(
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Loading your booking…</p>
      </div>
    ));
  }

  if (!booking) {
    return shell(card(
      <div className="text-center">
        <div className="text-4xl mb-3">🔗</div>
        <h1 className="text-xl font-bold text-gray-900">This link isn’t valid</h1>
        <p className="mt-2 text-gray-600">{error || 'The booking may have already been removed.'}</p>
      </div>
    ));
  }

  if (done === 'cancelled') {
    return shell(card(
      <div className="text-center">
        <div className="text-4xl mb-3">🗑</div>
        <h1 className="text-xl font-bold text-gray-900">Meeting cancelled</h1>
        <p className="mt-3 text-gray-600">
          {booking.eventTypeName} with {booking.ownerName} has been removed from both calendars.
        </p>
      </div>
    ));
  }

  if (done === 'rescheduled') {
    return shell(card(
      <div className="text-center">
        <div className="text-4xl mb-3">✅</div>
        <h1 className="text-xl font-bold text-gray-900">Moved</h1>
        <p className="mt-3 text-gray-700">{booking.eventTypeName} with {booking.ownerName}</p>
        <p className="mt-1 text-lg font-medium text-gray-900">{formatDateTime(booking.start, viewerTz)}</p>
        <p className="mt-1 text-sm text-gray-500">{viewerTz}</p>
        <p className="mt-4 text-sm text-gray-600">An updated invitation is on its way to {booking.email}.</p>
      </div>
    ));
  }

  if (booking.status === 'cancelled') {
    return shell(card(
      <div className="text-center">
        <div className="text-4xl mb-3">🗑</div>
        <h1 className="text-xl font-bold text-gray-900">Already cancelled</h1>
        <p className="mt-3 text-gray-600">
          This meeting was cancelled. Ask {booking.ownerName} for a booking link to pick a new time.
        </p>
      </div>
    ));
  }

  const summary = (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div className="font-medium text-gray-900">{booking.eventTypeName} with {booking.ownerName}</div>
      <div className="text-gray-700 mt-1">{formatDateTime(booking.start, viewerTz)}</div>
      <div className="text-xs text-gray-500 mt-1">
        {viewerTz}
        {booking.durationMinutes ? ` · ${booking.durationMinutes} minutes` : ''}
      </div>
    </div>
  );

  if (mode === 'cancel') {
    return shell(card(
      <>
        <h1 className="text-xl font-bold text-gray-900">Cancel this meeting?</h1>
        <div className="mt-4">{summary}</div>
        {error && <div className="mt-4 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
        <textarea
          className={`${inputClass} min-h-20 mt-4`}
          placeholder="Reason (optional)"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
        <div className="flex gap-2 mt-5">
          <Button variant="danger" onClick={cancel} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel meeting'}
          </Button>
          <a
            href={window.location.pathname.replace('/cancel/', '/reschedule/')}
            className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
          >
            Reschedule instead
          </a>
        </div>
      </>
    ));
  }

  return shell(card(
    <>
      <h1 className="text-xl font-bold text-gray-900">Pick a new time</h1>
      <div className="mt-4">{summary}</div>
      {error && <div className="mt-4 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <div className="mt-6">
        <BookingScheduler
          days={days}
          timezone={viewerTz}
          onTimezoneChange={setViewerTz}
          hostTimezone={booking.timezone}
          selected={selected}
          onSelect={setSelected}
          action={
            <Button className="w-full" onClick={reschedule} disabled={busy}>
              {busy ? 'Moving…' : 'Confirm'}
            </Button>
          }
        />
      </div>

      <div className="flex gap-2 mt-6 border-t border-gray-100 pt-5">
        <a
          href={window.location.pathname.replace('/reschedule/', '/cancel/')}
          className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
        >
          Cancel meeting instead
        </a>
      </div>
    </>
  ));
}
