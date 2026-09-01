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
  const [daysPerPage, setDaysPerPage] = useState(2);
  // "Why isn't this time open?" — a click on any time in an open-slots column.
  const [asking, setAsking] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{
    open: boolean;
    reasons: { code: string; detail: string }[];
    explanation: string;
  } | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
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

  const askAboutTime = async (startIso: string) => {
    setAsking(startIso);
    setAnswer(null);
    setAnswerError(null);
    try {
      const result = await api.explainSlot(
        eventTypeId,
        startIso,
        availability?.durationMinutes || 30
      );
      setAnswer(result);
    } catch (e) {
      setAnswerError((e as Error).message);
    }
  };

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

      {/*
        One grid, one time axis: each day appears twice — the schedule as it
        stands, then the slots that remain bookable — so the two sit right next
        to each other and a single scrollbar moves everything.
      */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <AvailabilityCalendar
          {...shared}
          events={availability.events}
          days={availability.days}
          commitmentTypes={availability.commitmentTypes}
          paired
          onPickTime={askAboutTime}
          snapMinutes={eventType.rules.slotIntervalMinutes}
          selectedTime={asking}
        />
        <p className="text-xs text-gray-500 mt-2">
          Click any time in an <span className="text-emerald-700">Open slots</span> column —
          including empty space — to ask why it is or isn't offered.
        </p>
      </div>

      {asking && (
        <div className="mt-4 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-medium text-gray-900">
                {formatDateTime(asking, eventType.rules.timezone)}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">{eventType.rules.timezone}</p>
            </div>
            <button
              onClick={() => { setAsking(null); setAnswer(null); setAnswerError(null); }}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Close
            </button>
          </div>

          {answerError ? (
            <div className="mt-3 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{answerError}</div>
          ) : !answer ? (
            <div className="mt-4 flex items-center gap-3 text-sm text-gray-500">
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
              Working out why…
            </div>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    answer.open ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {answer.open ? 'Bookable' : 'Not offered'}
                </span>
              </div>
              <p className="mt-3 text-sm text-gray-800">{answer.explanation}</p>
              {answer.reasons.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-gray-500">
                  {answer.reasons.map((reason, index) => (
                    <li key={`${reason.code}-${index}`}>· {reason.detail}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
