import { useEffect, useState } from 'react';
import type { TodoReport } from '../../types';
import { api } from '../../utils/api';
import { Button, ProgressSteps } from '../common';
import type { ProgressStep } from '../common/ProgressSteps';

const RANGES = [
  { days: 1, label: 'Last day' },
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
];

const PRIORITY_STYLE = {
  high: 'bg-red-50 text-red-700',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
};

const SOURCE_LABEL = { avoma: 'Avoma', gong: 'Gong', zoom: 'Zoom' };

function when(iso: string, timeZone: string) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function asText(report: TodoReport): string {
  const lines = [`To-dos from ${report.days === 1 ? 'the last day' : `the last ${report.days} days`} of meetings`, ''];
  for (const m of report.meetings) {
    if (!m.items?.length) continue;
    lines.push(`${m.title} — ${when(m.start, report.timezone)}`);
    for (const it of m.items) {
      lines.push(`- [ ] ${it.task}${it.due ? ` (due ${it.due})` : ''}${it.priority === 'high' ? ' [high]' : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

/**
 * Action items for you from your recorded meetings: Avoma's notes and Gong's
 * highlights (not the transcripts), read by the model.
 */
export function TodoReportPanel() {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<TodoReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  // The last report you made is kept.
  useEffect(() => {
    api.todoReport().then(r => setReport(r.report)).catch(() => {});
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    setSteps([]);
    setStartedAt(Date.now());
    const progressId = crypto.randomUUID();
    let finished = false;
    const poll = setInterval(async () => {
      try {
        const p = await api.progress(progressId);
        if (!finished) setSteps(p.steps);
      } catch {
        // Progress is best-effort.
      }
    }, 1500);
    try {
      setReport((await api.createTodoReport(days, progressId)).report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finished = true;
      clearInterval(poll);
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(asText(report));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Your browser blocked copying to the clipboard.');
    }
  };

  const total = report?.meetings.reduce((n, m) => n + (m.items?.length || 0), 0) || 0;

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">To-do report</h2>
          <p className="text-xs text-gray-500">
            Your action items from recorded meetings — read from Avoma's notes and Gong's highlights,
            not the transcripts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            disabled={busy}
          >
            {RANGES.map(r => <option key={r.days} value={r.days}>{r.label}</option>)}
          </select>
          <Button onClick={create} disabled={busy}>{busy ? 'Working…' : 'Create to-do report'}</Button>
        </div>
      </div>

      {busy && (
        <div className="px-5 pb-5">
          <ProgressSteps steps={steps} startedAt={startedAt} idleLabel="Gathering your recorded meetings…" />
        </div>
      )}
      {error && <div className="mx-5 mb-4 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}

      {report && !busy && (
        <div className="border-t border-gray-100">
          <div className="px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 bg-gray-50">
            <span>
              {total} to-do{total === 1 ? '' : 's'} from {report.meetings.length} meeting
              {report.meetings.length === 1 ? '' : 's'} · {report.days === 1 ? 'last day' : `last ${report.days} days`} ·
              made {new Date(report.generatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              {' '}· ${report.costUsd < 0.01 ? report.costUsd.toFixed(4) : report.costUsd.toFixed(3)}
            </span>
            {total > 0 && (
              <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={copy}>
                {copied ? 'Copied' : 'Copy as checklist'}
              </Button>
            )}
          </div>

          <div className="divide-y divide-gray-100">
            {report.meetings.map((m, i) => (
              <div key={i} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-gray-900">{m.title}</span>
                  <span className="text-xs text-gray-500">{when(m.start, report.timezone)}</span>
                  {m.recordings.map(r => (
                    <a
                      key={`${r.source}-${r.id}`}
                      href={r.url || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {SOURCE_LABEL[r.source]}
                    </a>
                  ))}
                </div>
                {m.items?.length ? (
                  <ul className="mt-2 space-y-2">
                    {m.items.map((it, j) => (
                      <li key={j} className="flex gap-2">
                        <input type="checkbox" className="mt-1" aria-label={it.task} />
                        <div className="text-sm">
                          <span className="text-gray-900">{it.task}</span>
                          <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded ${PRIORITY_STYLE[it.priority]}`}>
                            {it.priority}
                          </span>
                          {it.due && <span className="ml-2 text-xs text-gray-600">due {it.due}</span>}
                          {it.confidence === 'low' && (
                            <span className="ml-2 text-xs text-amber-700" title="The notes say 'we' — you may or may not own this">
                              probably yours
                            </span>
                          )}
                          {it.evidence && <div className="text-xs text-gray-400 mt-0.5">“{it.evidence}”</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-gray-400">No action items for you.</p>
                )}
              </div>
            ))}
          </div>

          {(report.skipped.length > 0 || report.errors.length > 0) && (
            <details className="px-5 py-3 border-t border-gray-100 text-xs text-gray-500">
              <summary className="cursor-pointer">
                {report.skipped.length} meeting{report.skipped.length === 1 ? '' : 's'} left out
                {report.errors.length ? ` · ${report.errors.length} error${report.errors.length === 1 ? '' : 's'}` : ''}
              </summary>
              <ul className="mt-2 space-y-1">
                {report.skipped.map((m, i) => (
                  <li key={i}>{m.title} — {when(m.start, report.timezone)}: {m.reason}</li>
                ))}
                {report.errors.map((e, i) => <li key={`e${i}`} className="text-red-700">{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
