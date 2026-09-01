import { useCallback, useEffect, useState } from 'react';
import type { CalendarStatus, EventType, SlotDay } from '../../types';
import { api } from '../../utils/api';
import { formatDayLabel, formatTime } from '../../utils/format';
import { Button, Modal } from '../common';
import { EventTypeForm } from './EventTypeForm';

const API_URL = import.meta.env.VITE_API_URL || '';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minutesToLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour12}:${String(m).padStart(2, '0')}${suffix}` : `${hour12}${suffix}`;
}

/** A plain-English readback of what the agent understood, so it can be checked. */
function rulesSummary(eventType: EventType) {
  const r = eventType.rules;
  const days = r.weekdays.length === 7 ? 'every day' : r.weekdays.map(d => DAY_NAMES[d]).join(', ');
  const parts = [
    `${r.durationMinutes} min`,
    days,
    `${minutesToLabel(r.startMinute)}–${minutesToLabel(r.endMinute)} ${r.timezone}`,
    `${r.horizonWeeks} week${r.horizonWeeks === 1 ? '' : 's'} ahead`,
  ];
  if (r.minNoticeHours) parts.push(`${r.minNoticeHours}h notice`);
  if (r.bufferMinutes) parts.push(`${r.bufferMinutes} min buffer`);
  if (r.maxPerDay) parts.push(`max ${r.maxPerDay}/day`);
  return parts.join(' · ');
}

export function EventTypesPage() {
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EventType | null>(null);
  const [preview, setPreview] = useState<{ eventType: EventType; days: SlotDay[] } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [{ eventTypes }, status] = await Promise.all([
        api.listEventTypes(),
        api.calendarStatus(),
      ]);
      setEventTypes(eventTypes);
      setCalendar(status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load; state settles once the fetches resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();

    // The calendar connect flow returns here with a status in the query string.
    const params = new URLSearchParams(window.location.search);
    const result = params.get('calendar');
    if (result) {
      setNotice(
        result === 'connected'
          ? 'Google Calendar connected.'
          : 'Could not connect Google Calendar. Please try again.'
      );
      window.history.replaceState({}, '', '/event-types');
    }
  }, [load]);

  const bookingUrl = (eventType: EventType) => `${window.location.origin}/book/${eventType.slug}`;

  const copyLink = async (eventType: EventType) => {
    const url = bookingUrl(eventType);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(eventType.id);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt('Copy this booking link:', url);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleSubmit = async (values: { name: string; description: string; guidance: string; timezone: string }) => {
    if (editing) {
      await api.updateEventType(editing.id, values);
    } else {
      await api.createEventType(values);
    }
    closeForm();
    await load();
  };

  const toggleActive = async (eventType: EventType) => {
    await api.updateEventType(eventType.id, { active: !eventType.active });
    await load();
  };

  const remove = async (eventType: EventType) => {
    if (!window.confirm(`Delete "${eventType.name}"? Its booking link will stop working.`)) return;
    await api.deleteEventType(eventType.id);
    await load();
  };

  const showPreview = async (eventType: EventType) => {
    setError(null);
    try {
      const { days } = await api.eventTypeAvailability(eventType.id);
      setPreview({ eventType, days });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar? Booking pages will stop working until you reconnect.')) return;
    await api.disconnectCalendar();
    await load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Event types</h1>
          <p className="text-sm text-gray-500 mt-1">
            Describe your availability in plain English; share the link; people book real
            time on your calendar.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} disabled={!calendar?.connected}>
          + New event type
        </Button>
      </div>

      {notice && <div className="rounded-lg bg-green-50 text-green-800 px-4 py-3 text-sm mb-4">{notice}</div>}
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm mb-4">{error}</div>}

      {/* Calendar connection */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-medium text-gray-900">Google Calendar</h2>
          <p className="text-sm text-gray-500 mt-1">
            {calendar?.connected
              ? 'Connected — availability comes from your primary calendar, and bookings are written to it.'
              : 'Connect your calendar so the agent can read your free time and create invites.'}
          </p>
        </div>
        {calendar?.connected ? (
          <Button variant="secondary" onClick={disconnect}>Disconnect</Button>
        ) : (
          <Button onClick={() => { window.location.href = `${API_URL}/api/calendar/connect`; }}>
            Connect calendar
          </Button>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">Loading…</div>
      ) : eventTypes.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">🗓</div>
          <h2 className="font-medium text-gray-900">No event types yet</h2>
          <p className="text-sm text-gray-500 mt-1">
            {calendar?.connected
              ? 'Create one to get a shareable booking link.'
              : 'Connect your Google Calendar first.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {eventTypes.map(eventType => (
            <div key={eventType.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{eventType.name}</h3>
                    {!eventType.active && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">paused</span>
                    )}
                  </div>
                  {eventType.description && (
                    <p className="text-sm text-gray-600 mt-1">{eventType.description}</p>
                  )}
                  <p className="text-sm text-gray-500 mt-2 italic">“{eventType.guidance}”</p>
                  <p className="text-xs text-gray-500 mt-2">
                    <span className="font-medium text-gray-700">Agent read this as:</span>{' '}
                    {rulesSummary(eventType)}
                    {eventType.rulesSource === 'text' && (
                      <span className="text-amber-600"> · parsed without the model</span>
                    )}
                  </p>
                  {eventType.rules.summary && (
                    <p className="text-xs text-gray-500 mt-1">{eventType.rules.summary}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Button variant="ghost" onClick={() => showPreview(eventType)}>Preview slots</Button>
                  <Button variant="ghost" onClick={() => { setEditing(eventType); setShowForm(true); }}>Edit</Button>
                  <Button variant="ghost" onClick={() => toggleActive(eventType)}>
                    {eventType.active ? 'Pause' : 'Resume'}
                  </Button>
                  <Button variant="ghost" onClick={() => remove(eventType)}>Delete</Button>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-4">
                <code className="flex-1 truncate text-xs bg-gray-50 rounded-lg px-3 py-2 text-gray-700">
                  {bookingUrl(eventType)}
                </code>
                <Button variant="secondary" onClick={() => copyLink(eventType)}>
                  {copied === eventType.id ? 'Copied' : 'Copy link'}
                </Button>
                <a
                  href={`/book/${eventType.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800 px-2"
                >
                  Open
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={showForm}
        onClose={closeForm}
        title={editing ? 'Edit event type' : 'New event type'}
      >
        <EventTypeForm
          eventType={editing || undefined}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      </Modal>

      <Modal
        isOpen={!!preview}
        onClose={() => setPreview(null)}
        title={preview ? `Open slots — ${preview.eventType.name}` : ''}
        wide
      >
        {preview && (
          preview.days.length === 0 ? (
            <p className="text-sm text-gray-600">
              No open slots in the next {preview.eventType.rules.horizonWeeks} week(s).
            </p>
          ) : (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {preview.days.map(day => (
                <div key={day.date}>
                  <div className="text-sm font-medium text-gray-900">
                    {formatDayLabel(day.slots[0].start)}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {day.slots.map(slot => (
                      <span
                        key={slot.start}
                        className="text-sm px-3 py-1 rounded-lg border border-gray-200 text-gray-700"
                      >
                        {formatTime(slot.start, preview.eventType.rules.timezone)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </Modal>
    </div>
  );
}
