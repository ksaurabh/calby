import type { EventExplanation as Explanation } from '../../types';
import { formatDateTime } from '../../utils/format';

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'high confidence',
  medium: 'medium confidence',
  low: 'low confidence',
};

/** The per-event report: one verdict for every commitment type, with reasons. */
export function EventExplanationReport({
  explanation,
  timezone,
}: {
  explanation: Explanation;
  timezone: string;
}) {
  const { event, summary, verdicts, calculatedAt, cached } = explanation;

  return (
    <div className="space-y-5">
      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
        <div className="font-medium text-gray-900">{event.summary}</div>
        <div className="text-sm text-gray-600 mt-1">
          {event.allDay ? `${event.start} (all day)` : formatDateTime(event.start, timezone)}
          {!event.allDay && ` – ${new Date(event.end).toLocaleTimeString(undefined, {
            hour: 'numeric', minute: '2-digit', timeZone: timezone,
          })}`}
        </div>
        {event.organizer && (
          <div className="text-sm text-gray-600 mt-1">
            Organized by {event.organizer.name || event.organizer.email}
            {event.organizer.self && ' (you)'}
          </div>
        )}
        {!!event.attendees?.length && (
          <div className="text-sm text-gray-600 mt-1">
            Guests: {event.attendees.map(a => a.name || a.email).join(', ')}
          </div>
        )}
        {event.location && <div className="text-sm text-gray-600 mt-1">Location: {event.location}</div>}
      </div>

      {summary && <p className="text-sm text-gray-800">{summary}</p>}

      {calculatedAt && (
        <p className="text-xs text-gray-400">
          Calculated at {formatDateTime(calculatedAt, timezone)}
          {cached && ' · reused from that run, since neither this event nor your commitment types have changed'}
        </p>
      )}

      {verdicts.length === 0 ? (
        <p className="text-sm text-gray-600">
          No commitment types are defined yet — add one and the report will explain this
          entry against it.
        </p>
      ) : (
        <div className="space-y-3">
          {verdicts.map(verdict => (
            <div
              key={verdict.commitmentTypeId}
              className="border rounded-lg p-4"
              style={{
                borderColor: verdict.matches ? verdict.color : '#e5e7eb',
                backgroundColor: verdict.matches ? `${verdict.color}12` : undefined,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3 h-3 rounded shrink-0 border"
                    style={{ backgroundColor: `${verdict.color}33`, borderColor: verdict.color }}
                  />
                  <span className="font-medium text-gray-900 truncate">{verdict.name}</span>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                    verdict.matches ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {verdict.matches ? 'Matches' : 'No match'} · {CONFIDENCE_LABEL[verdict.confidence]}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1 italic">“{verdict.condition}”</p>
              <p className="text-sm text-gray-700 mt-2">{verdict.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
