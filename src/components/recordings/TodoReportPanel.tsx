import { useEffect, useState } from 'react';
import type { SavedTodoReport, TodoReport } from '../../types';
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

const smallButton = '!px-2 !py-1 text-xs';

const countItems = (report: TodoReport) => report.meetings.reduce((n, m) => n + (m.items?.length || 0), 0);

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function asText(report: TodoReport, done: Record<string, boolean> = {}): string {
  const lines = [`To-dos from ${report.days === 1 ? 'the last day' : `the last ${report.days} days`} of meetings`, ''];
  for (const m of report.meetings) {
    if (!m.items?.length) continue;
    lines.push(`${m.title} — ${when(m.start, report.timezone)}`);
    const i = report.meetings.indexOf(m);
    for (const [j, it] of m.items.entries()) {
      lines.push(`- [${done[`${i}-${j}`] ? 'x' : ' '}] ${it.task}${it.due ? ` (due ${it.due})` : ''}${it.priority === 'high' ? ' [high]' : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** One report's meetings and items; ticking items is kept only for saved reports. */
function ReportView({ report, done, onToggle, actions }: {
  report: TodoReport;
  done?: Record<string, boolean>;
  onToggle?: (key: string, done: boolean) => void;
  actions: React.ReactNode;
}) {
  const total = countItems(report);
  const doneCount = done ? Object.keys(done).length : 0;
  return (
    <div className="border-t border-gray-100">
      <div className="px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 bg-gray-50">
        <span>
          {total} to-do{total === 1 ? '' : 's'}
          {done && total > 0 && ` (${doneCount} done)`} from {report.meetings.length} meeting
          {report.meetings.length === 1 ? '' : 's'} · {report.days === 1 ? 'last day' : `last ${report.days} days`} ·
          made {shortDate(report.generatedAt)}
          {' '}· ${report.costUsd < 0.01 ? report.costUsd.toFixed(4) : report.costUsd.toFixed(3)}
        </span>
        <div className="flex items-center gap-1">{actions}</div>
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
                {m.items.map((it, j) => {
                  const key = `${i}-${j}`;
                  const checked = !!done?.[key];
                  return (
                    <li key={j} className="flex gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        aria-label={it.task}
                        {...(onToggle
                          ? { checked, onChange: e => onToggle(key, e.target.checked) }
                          : {})}
                      />
                      <div className="text-sm">
                        <span className={checked ? 'text-gray-400 line-through' : 'text-gray-900'}>{it.task}</span>
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
                  );
                })}
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
  );
}

/**
 * Action items for you from your recorded meetings: Avoma's notes and Gong's
 * highlights (not the transcripts), read by the model. Reports you save are
 * kept as todo-report-<date>, with the items you tick off.
 */
export function TodoReportPanel() {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<TodoReport | null>(null);
  const [saved, setSaved] = useState<SavedTodoReport[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  // The last report you made is kept, and so are the ones you saved.
  useEffect(() => {
    api.todoReport().then(r => setReport(r.report)).catch(() => {});
    api.savedTodoReports().then(r => setSaved(r.saved)).catch(() => {});
  }, []);

  const open = saved.find(s => s.id === openId) || null;
  const savedAs = report ? saved.find(s => s.report.generatedAt === report.generatedAt) : undefined;

  const create = async () => {
    setBusy(true);
    setError(null);
    setSteps([]);
    setStartedAt(Date.now());
    setOpenId(null);
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

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { saved: entry } = await api.saveTodoReport();
      setSaved(list => [entry, ...list]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (id: string, key: string, done: boolean) => {
    // Show it at once; put it back if the server says no.
    const flip = (on: boolean) =>
      setSaved(list => list.map(s => {
        if (s.id !== id) return s;
        const next = { ...s.done };
        if (on) next[key] = true;
        else delete next[key];
        return { ...s, done: next };
      }));
    flip(done);
    try {
      await api.markTodo(id, key, done);
    } catch (e) {
      flip(!done);
      setError((e as Error).message);
    }
  };

  const remove = async (entry: SavedTodoReport) => {
    if (!window.confirm(`Delete ${entry.name}?`)) return;
    setError(null);
    try {
      await api.deleteSavedTodoReport(entry.id);
      setSaved(list => list.filter(s => s.id !== entry.id));
      if (openId === entry.id) setOpenId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copy = async (r: TodoReport, done?: Record<string, boolean>) => {
    try {
      await navigator.clipboard.writeText(asText(r, done));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Your browser blocked copying to the clipboard.');
    }
  };

  const copyButton = (r: TodoReport, done?: Record<string, boolean>) =>
    countItems(r) > 0 && (
      <Button variant="ghost" className={smallButton} onClick={() => copy(r, done)}>
        {copied ? 'Copied' : 'Copy as checklist'}
      </Button>
    );

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

      {!busy && open && (
        <>
          <div className="px-5 py-2 border-t border-gray-100 flex items-center justify-between gap-2 text-sm">
            <span className="font-mono text-gray-900">{open.name}</span>
            <Button variant="ghost" className={smallButton} onClick={() => setOpenId(null)}>
              {report ? 'Back to latest report' : 'Close'}
            </Button>
          </div>
          <ReportView
            report={open.report}
            done={open.done}
            onToggle={(key, done) => toggle(open.id, key, done)}
            actions={copyButton(open.report, open.done)}
          />
        </>
      )}

      {!busy && !open && report && (
        <ReportView
          report={report}
          actions={
            <>
              {copyButton(report)}
              {savedAs ? (
                <Button variant="ghost" className={smallButton} onClick={() => setOpenId(savedAs.id)}>
                  Saved as {savedAs.name}
                </Button>
              ) : (
                <Button variant="secondary" className={smallButton} onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save report'}
                </Button>
              )}
            </>
          }
        />
      )}

      {saved.length > 0 && (
        <div className="border-t border-gray-200">
          <h3 className="px-5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Saved reports</h3>
          <ul className="divide-y divide-gray-100">
            {saved.map(s => {
              const total = countItems(s.report);
              const doneCount = Object.keys(s.done).length;
              return (
                <li key={s.id} className={`px-5 py-2 flex flex-wrap items-center justify-between gap-2 ${s.id === openId ? 'bg-blue-50' : ''}`}>
                  <div className="text-sm">
                    <span className="font-mono text-gray-900">{s.name}</span>
                    <span className="text-xs text-gray-500">
                      {' '}· {s.report.days === 1 ? 'last day' : `last ${s.report.days} days`} · {doneCount} of {total} done
                      {' '}· saved {shortDate(s.savedAt)}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" className={smallButton} onClick={() => setOpenId(s.id === openId ? null : s.id)}>
                      {s.id === openId ? 'Close' : 'Open'}
                    </Button>
                    <Button variant="ghost" className={smallButton} onClick={() => remove(s)}>Delete</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
