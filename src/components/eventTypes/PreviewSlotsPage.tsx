import { useCallback, useEffect, useState } from 'react';
import type { CalendarEvent, CommitmentType, EventType, SlotDay } from '../../types';
import { api } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { navigate } from '../../utils/navigate';
import { AvailabilityCalendar } from '../calendar';
import { Button } from '../common';

interface Availability {
  days: SlotDay[];
  events: CalendarEvent[];
  commitmentTypes: CommitmentType[];
  durationMinutes: number;
  reviewNote: string | null;
  drops: { start: string; reason: string }[];
}

/**
 * The availability preview, as a page of its own: the owner's calendar beside
 * the slots visitors would see, driven by one set of controls.
 */
export function PreviewSlotsPage({ eventTypeId }: { eventTypeId: string }) {
  const [eventType, setEventType] = useState<EventType | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [daysPerPage, setDaysPerPage] = useState(3);
  const [pageOffset, setPageOffset] = useState(0);

  const load = useCallback(async (durationMinutes?: number) => {
    setLoading(true);
    setError(null);
    try {
      const { eventTypes } = await api.listEventTypes();
      const found = eventTypes.find(e => e.id === eventTypeId) || null;
      setEventType(found);
      if (!found) {
        setError('That event type no longer exists.');
        return;
      }
      setAvailability(await api.eventTypeAvailability(eventTypeId, durationMinutes));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [eventTypeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const back = () => navigate('/');

  const header = (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
      <div>
        <button onClick={back} className="text-sm text-blue-600 hover:text-blue-800">
          ← Back to event types
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Previewing open slots</h1>
        {eventType && (
          <p className="text-sm text-gray-500 mt-1">
            {eventType.name}
            {eventType.externalName && eventType.externalName !== eventType.name &&
              ` · guests see “${eventType.externalName}”`}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => load(availability?.durationMinutes)}>
          Refresh
        </Button>
        <Button onClick={back}>Done</Button>
      </div>
    </div>
  );

  if (loading && !availability) {
    return (
      <div className="max-w-7xl mx-auto">
        {header}
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
          Checking your calendar…
        </div>
      </div>
    );
  }

  if (error || !eventType || !availability) {
    return (
      <div className="max-w-7xl mx-auto">
        {header}
        <div className="rounded-lg bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          {error || 'Could not load this preview.'}
        </div>
      </div>
    );
  }

  const window = {
    timezone: eventType.rules.timezone,
    startMinute: eventType.rules.startMinute,
    endMinute: eventType.rules.endMinute,
    weeks: eventType.rules.horizonWeeks,
  };
  const shared = {
    window,
    daysPerPage,
    onDaysPerPageChange: setDaysPerPage,
    pageOffset,
    onPageOffsetChange: setPageOffset,
  };
  const options = eventType.rules.durationOptions?.length
    ? eventType.rules.durationOptions
    : [eventType.rules.durationMinutes];

  return (
    <div className="max-w-7xl mx-auto">
      {header}

      {options.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-sm text-gray-600">Meeting length</span>
          {options.map(minutes => (
            <button
              key={minutes}
              onClick={() => load(minutes)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                availability.durationMinutes === minutes
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 text-gray-700 hover:border-blue-500 hover:bg-blue-50'
              }`}
            >
              {minutes} min
            </button>
          ))}
        </div>
      )}

      {availability.reviewNote && (
        <div className="mb-4 rounded-lg bg-blue-50 text-blue-900 px-4 py-3 text-sm">
          <span className="font-medium">Commitment-aware review:</span> {availability.reviewNote}
          {availability.drops.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-blue-800">
              {availability.drops.slice(0, 8).map(drop => (
                <li key={drop.start}>
                  · {formatDateTime(drop.start, eventType.rules.timezone)} — {drop.reason}
                </li>
              ))}
              {availability.drops.length > 8 && <li>· and {availability.drops.length - 8} more</li>}
            </ul>
          )}
        </div>
      )}

      {availability.days.length === 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          No open slots in the next {eventType.rules.horizonWeeks} week(s) — your calendar is
          full, or the guidance is narrower than you intended.
        </div>
      )}

      {/* One toolbar drives both calendars, so the two sides stay aligned. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <AvailabilityCalendar
          {...shared}
          events={availability.events}
          days={availability.days}
          commitmentTypes={availability.commitmentTypes}
          controlsOnly
        />
      </div>

      {/*
        Both halves get the same events and the same window, so their time axes
        are identical — the right one just doesn't paint the meetings. One
        scroll container wraps the pair, so a single scrollbar moves both.
      */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="grid grid-cols-2 gap-4 px-4 pt-4">
          <h2 className="text-sm font-medium text-gray-900">
            Your calendar
            <span className="font-normal text-gray-500"> — what is already booked</span>
          </h2>
          <h2 className="text-sm font-medium text-gray-900">
            Open slots
            <span className="font-normal text-gray-500"> — what visitors can book</span>
          </h2>
        </div>

        <div className="overflow-auto max-h-[70vh] p-4">
          <div className="grid grid-cols-2 gap-4 min-w-max">
            <AvailabilityCalendar
              {...shared}
              events={availability.events}
              commitmentTypes={availability.commitmentTypes}
              showControls={false}
              showLegend={false}
              scrollable={false}
            />
            <AvailabilityCalendar
              {...shared}
              events={availability.events}
              days={availability.days}
              commitmentTypes={availability.commitmentTypes}
              hideEvents
              showControls={false}
              showLegend={false}
              scrollable={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
