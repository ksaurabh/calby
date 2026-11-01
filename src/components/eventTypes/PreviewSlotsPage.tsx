import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent, CommitmentType, EventType, SchedulingRules, SlotDay } from '../../types';
import { api, type GuidanceSuggestion } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { navigate } from '../../utils/navigate';
import { AvailabilityCalendar } from '../calendar';
import { SuggestSlots } from './SuggestSlots';
import { Button, Modal, ProgressSteps } from '../common';
import type { ProgressStep } from '../common/ProgressSteps';

interface Availability {
  days: SlotDay[];
  rules: SchedulingRules;
  guidance: string;
  draft: boolean;
  calendarFetchedAt: string;
  events: CalendarEvent[];
  commitmentTypes: CommitmentType[];
  durationMinutes: number;
  reviewNote: string | null;
  drops: { start: string; reason: string }[];
}

const AUTO_REFRESH_MS = 5 * 60 * 1000;

interface LoadOptions {
  durationMinutes?: number;
  /** Unsaved guidance to preview; omit for the saved guidance. */
  guidance?: string;
  /** Re-read the calendar from Google instead of the recent copy. */
  refresh?: boolean;
}

function timeAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  return `${minutes} minutes ago`;
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
  // A click marks a time; the explanation is only fetched when asked for.
  const [picked, setPicked] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{
    open: boolean;
    reasons: { code: string; detail: string }[];
    explanation: string;
    fixableByGuidance: boolean;
    suggestion: GuidanceSuggestion | null;
  } | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [pageOffset, setPageOffset] = useState(0);
  // What the server is doing while the availability loads.
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  // The guidance being edited; recalculating previews it without saving.
  const [guidanceText, setGuidanceText] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const loadingRef = useRef(false);

  const load = useCallback(async (options: LoadOptions = {}) => {
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setSteps([]);
    setStartedAt(Date.now());
    const progressId = crypto.randomUUID();
    let finished = false;
    // Poll for the server's progress while the request runs.
    const poll = setInterval(async () => {
      try {
        const progress = await api.progress(progressId);
        if (!finished) setSteps(progress.steps);
      } catch {
        // Progress is best-effort; the request itself reports real errors.
      }
    }, 1500);
    try {
      const { eventTypes } = await api.listEventTypes();
      const found = eventTypes.find(e => e.id === eventTypeId) || null;
      setEventType(found);
      if (!found) {
        setError('That event type no longer exists.');
        return;
      }
      const result = await api.eventTypeAvailability(eventTypeId, options, progressId);
      setAvailability(result);
      // First load: start the editor from the saved guidance.
      setGuidanceText(text => text || result.guidance);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finished = true;
      clearInterval(poll);
      loadingRef.current = false;
      setLoading(false);
    }
  }, [eventTypeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // What the current preview was computed from, so a reload keeps it.
  const current = useCallback((): LoadOptions => ({
    durationMinutes: availability?.durationMinutes,
    guidance: availability?.draft ? availability.guidance : undefined,
  }), [availability]);

  // Re-read the calendar every five minutes, keeping whatever is previewed.
  // Skipped while another load is running or the tab is in the background.
  useEffect(() => {
    const timer = setInterval(() => {
      if (loadingRef.current || document.hidden) return;
      load({ ...current(), refresh: true });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, current]);

  // Keeps "read 3 minutes ago" current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const recalculate = () => {
    setNotice(null);
    setPicked(null);
    load({ durationMinutes: availability?.durationMinutes, guidance: guidanceText });
  };

  const saveGuidance = async () => {
    if (!availability?.draft) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateEventType(eventTypeId, { guidance: availability.guidance });
      setEventType(updated);
      setNotice('Guidance saved. Your booking link now offers these slots.');
      // Same guidance as just previewed: rules, calendar and review are all cached.
      await load({ durationMinutes: availability.durationMinutes });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Put a suggested guidance in the editor and preview it (unsaved).
  const trySuggestion = (suggestion: GuidanceSuggestion) => {
    setShowAnswer(false);
    setNotice(null);
    setGuidanceText(suggestion.guidance);
    load({ durationMinutes: availability?.durationMinutes, guidance: suggestion.guidance });
  };

  const discardDraft = () => {
    if (!eventType) return;
    setGuidanceText(eventType.guidance);
    setNotice(null);
    load({ durationMinutes: availability?.durationMinutes });
  };

  const back = () => navigate('/');

  const pickTime = (startIso: string) => {
    setPicked(startIso);
    setAnswer(null);
    setAnswerError(null);
    setShowAnswer(false);
  };

  const explainPicked = async () => {
    if (!picked) return;
    setShowAnswer(true);
    setAsking(true);
    setAnswer(null);
    setAnswerError(null);
    try {
      setAnswer(await api.explainSlot(
        eventTypeId,
        picked,
        availability?.durationMinutes || 30,
        availability?.draft ? availability.guidance : undefined
      ));
    } catch (e) {
      setAnswerError((e as Error).message);
    } finally {
      setAsking(false);
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
        <Button onClick={back}>Done</Button>
      </div>
    </div>
  );

  if (loading && !availability) {
    return (
      <div className="max-w-7xl mx-auto">
        {header}
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
          <ProgressSteps steps={steps} startedAt={startedAt} idleLabel="Checking your calendar…" />
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

  // The rules behind what's on screen: the draft's while previewing one.
  const rules = availability.rules;
  const window = {
    timezone: rules.timezone,
    startMinute: rules.startMinute,
    endMinute: rules.endMinute,
    weeks: rules.horizonWeeks,
  };
  const shared = {
    window,
    daysPerPage,
    onDaysPerPageChange: setDaysPerPage,
    pageOffset,
    onPageOffsetChange: setPageOffset,
  };
  const options = rules.durationOptions?.length ? rules.durationOptions : [rules.durationMinutes];
  const edited = guidanceText.trim() !== availability.guidance.trim();

  return (
    <div className="max-w-7xl mx-auto">
      {header}
      {loading && (
        <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/50 px-6 py-4">
          <ProgressSteps steps={steps} startedAt={startedAt} idleLabel="Refreshing…" />
        </div>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <label htmlFor="guidance" className="font-medium text-gray-900">Guidance</label>
            <span className="text-xs text-gray-500">When may people book this? Plain English.</span>
          </div>
          <textarea
            id="guidance"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-24 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            value={guidanceText}
            onChange={e => setGuidanceText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && edited && !loading) recalculate();
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button onClick={recalculate} disabled={loading || !edited || !guidanceText.trim()}>
              Recalculate available slots
            </Button>
            {edited && !loading && (
              <span className="text-xs text-gray-500">Edited · ⌘/Ctrl+Enter to recalculate</span>
            )}
          </div>
          {rules.summary && (
            <p className="mt-3 text-xs text-gray-600">
              <span className="font-medium text-gray-700">Read as:</span> {rules.summary}
            </p>
          )}
          {availability.draft && (
            <div className="mt-3 rounded-lg bg-amber-50 text-amber-900 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-48">
                Previewing <strong>unsaved</strong> guidance — your booking link still uses the saved version.
              </span>
              <Button onClick={saveGuidance} disabled={saving || loading}>
                {saving ? 'Saving…' : 'Save guidance'}
              </Button>
              <Button variant="secondary" onClick={discardDraft} disabled={saving || loading}>Discard</Button>
            </div>
          )}
          {notice && <div className="mt-3 rounded-lg bg-green-50 text-green-800 px-3 py-2 text-sm">{notice}</div>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm lg:w-64">
          <div className="font-medium text-gray-900">Calendar</div>
          <p className="text-gray-600 mt-1">
            Read from Google at {new Date(availability.calendarFetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            <span className="text-gray-400"> · {timeAgo(availability.calendarFetchedAt, now)}</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Recalculating reuses this copy. It re-reads automatically every 5 minutes.
          </p>
          <Button
            variant="secondary"
            className="mt-3 w-full"
            disabled={loading}
            onClick={() => { setNotice(null); load({ ...current(), refresh: true }); }}
          >
            Refresh calendar now
          </Button>
        </div>
      </div>

      {options.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-sm text-gray-600">Meeting length</span>
          {options.map(minutes => (
            <button
              key={minutes}
              onClick={() => load({ ...current(), durationMinutes: minutes })}
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
                  · {formatDateTime(drop.start, rules.timezone)} — {drop.reason}
                </li>
              ))}
              {availability.drops.length > 8 && <li>· and {availability.drops.length - 8} more</li>}
            </ul>
          )}
        </div>
      )}

      {availability.days.length === 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          No open slots in the next {rules.horizonWeeks} week(s) — your calendar is
          full, or the guidance is narrower than you intended.
        </div>
      )}

      <div className="mb-4">
        <SuggestSlots
          eventType={{ ...eventType, rules }}
          durationMinutes={availability.durationMinutes}
          guidance={availability.draft ? availability.guidance : undefined}
        />
      </div>

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
          onPickTime={pickTime}
          snapMinutes={rules.slotIntervalMinutes}
          selectedTime={picked}
          selectionActions={picked && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-lg p-2">
              <div className="px-1 pb-1.5 text-xs font-medium text-gray-700">
                {new Date(picked).toLocaleTimeString([], { timeZone: rules.timezone, hour: 'numeric', minute: '2-digit' })}
                <span className="text-gray-400 font-normal"> · {availability.durationMinutes} min</span>
              </div>
              <div className="flex gap-1">
                <Button className="!px-2.5 !py-1 text-xs" onClick={explainPicked}>Explain this slot</Button>
                <Button
                  variant="secondary"
                  className="!px-2.5 !py-1 text-xs"
                  onClick={() => { setPicked(null); setShowAnswer(false); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        />
        <p className="text-xs text-gray-500 mt-2">
          Click any time in an <span className="text-emerald-700">Open slots</span> column —
          including empty space — and choose <em>Explain this slot</em>.
        </p>
      </div>

      <Modal
        isOpen={showAnswer}
        onClose={() => setShowAnswer(false)}
        title={picked ? formatDateTime(picked, rules.timezone) : ''}
      >
        {answerError ? (
          <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{answerError}</div>
        ) : asking || !answer ? (
          <div className="py-8 flex items-center justify-center gap-3 text-sm text-gray-500">
            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
            Working out why…
          </div>
        ) : (
          <div className="space-y-3">
            <span
              className={`inline-block text-xs px-2 py-0.5 rounded-full ${
                answer.open ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {answer.open ? 'Bookable' : 'Not offered'}
            </span>
            <p className="text-sm text-gray-800">{answer.explanation}</p>
            {answer.reasons.length > 0 && (
              <ul className="space-y-1 text-xs text-gray-500 border-t border-gray-100 pt-3">
                {answer.reasons.map((reason, index) => (
                  <li key={`${reason.code}-${index}`}>· {reason.detail}</li>
                ))}
              </ul>
            )}

            {!answer.open && answer.suggestion && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-2">
                <div className="text-sm font-medium text-gray-900">To offer this time, change your guidance to:</div>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-800 bg-white border border-gray-200 rounded-md p-2">
                  {answer.suggestion.guidance}
                </pre>
                {answer.suggestion.change && (
                  <p className="text-xs text-gray-600">{answer.suggestion.change}</p>
                )}
                <p
                  className={`text-xs ${
                    answer.suggestion.opensSlot
                      ? 'text-emerald-700'
                      : answer.suggestion.verified
                        ? 'text-amber-700'
                        : 'text-red-700'
                  }`}
                >
                  {answer.suggestion.opensSlot
                    ? '✓ Checked: with this guidance, this time would be offered.'
                    : answer.suggestion.verified
                      ? `✓ The guidance would no longer block it, but it still wouldn't be offered: ${answer.suggestion.remainingReasons.map(r => r.detail).join(' ')}`
                      : `⚠ Checked, and this wouldn't be enough: ${answer.suggestion.remainingReasons.map(r => r.detail).join(' ')}`}
                </p>
                {answer.suggestion.readAs && (
                  <p className="text-xs text-gray-500">Would be read as: {answer.suggestion.readAs}</p>
                )}
                <div className="flex justify-end">
                  <Button onClick={() => trySuggestion(answer.suggestion!)}>Try this guidance</Button>
                </div>
                <p className="text-[11px] text-gray-400 text-right">
                  Previews it here; your booking link changes only if you save.
                </p>
              </div>
            )}
            {!answer.open && !answer.fixableByGuidance && (
              <p className="text-xs text-gray-500 border-t border-gray-100 pt-3">
                This time is blocked by your calendar, not by your guidance, so no change to the
                guidance would open it.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
