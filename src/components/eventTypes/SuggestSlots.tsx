import { useState } from 'react';
import type { EventType } from '../../types';
import { api } from '../../utils/api';
import { Button } from '../common';

interface Suggestion {
  slots: { start: string; end: string }[];
  totalAvailable: number;
  consideredDays: string[];
  fromBusinessDay: number;
  toBusinessDay: number;
  timezone: string;
}

/**
 * "Six times in the next five business days" — a short list to paste into an
 * email. A range like 5–10 starts the window on the fifth business day, so the
 * earliest time offered is that far out.
 */
export function SuggestSlots({
  eventType,
  durationMinutes,
}: {
  eventType: EventType;
  durationMinutes: number;
}) {
  const [count, setCount] = useState(6);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(5);
  const [useRange, setUseRange] = useState(false);
  const [result, setResult] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setResult(await api.suggestSlots(eventType.id, {
        count,
        fromBusinessDay: useRange ? from : 1,
        toBusinessDay: to,
        durationMinutes,
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const line = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      timeZone: result?.timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const asText = () =>
    [
      ...(result?.slots || []).map(slot => `- ${line(slot.start)}`),
      `(${durationMinutes} minutes, times in ${result?.timezone})`,
    ].join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy these times:', asText());
    }
  };

  const numberInput = 'w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-medium text-gray-900">Suggest times</h2>
      <p className="text-xs text-gray-500 mt-1">
        A short list of open times to paste into an email. Today counts as business day 1
        when it's a weekday; weekends are skipped, holidays aren't.
      </p>

      <form onSubmit={generate} className="flex items-center gap-2 flex-wrap mt-4 text-sm text-gray-700">
        <span>Next</span>
        <input
          className={numberInput}
          type="number"
          min={1}
          max={20}
          value={count}
          onChange={e => setCount(Number(e.target.value))}
        />
        <span>open slots within</span>
        {useRange ? (
          <>
            <input
              className={numberInput}
              type="number"
              min={1}
              max={30}
              value={from}
              onChange={e => setFrom(Number(e.target.value))}
            />
            <span>–</span>
          </>
        ) : null}
        <input
          className={numberInput}
          type="number"
          min={1}
          max={30}
          value={to}
          onChange={e => setTo(Number(e.target.value))}
        />
        <span>business days</span>
        <Button type="submit" disabled={busy}>{busy ? 'Finding…' : 'Generate'}</Button>
        <button
          type="button"
          onClick={() => setUseRange(v => !v)}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          {useRange ? 'Use a single limit' : 'Use a range'}
        </button>
      </form>

      {useRange && (
        <p className="text-xs text-gray-500 mt-2">
          The earliest time offered will be {from} business day{from === 1 ? '' : 's'} out.
        </p>
      )}

      {error && <div className="mt-3 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}

      {result && !error && (
        <div className="mt-4">
          {result.slots.length === 0 ? (
            <p className="text-sm text-gray-600">
              No open slots between business day {result.fromBusinessDay} and{' '}
              {result.toBusinessDay}.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-gray-500">
                  {result.slots.length} of {result.totalAvailable} open slot
                  {result.totalAvailable === 1 ? '' : 's'} in that window · times in{' '}
                  {result.timezone}
                </p>
                <Button variant="secondary" onClick={copy}>
                  {copied ? 'Copied' : 'Copy list'}
                </Button>
              </div>
              <ul className="mt-2 space-y-1">
                {result.slots.map(slot => (
                  <li key={slot.start} className="text-sm text-gray-800">
                    · {line(slot.start)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
