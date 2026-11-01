import { useState } from 'react';
import type { Recording, ZoomSummary } from '../../types';
import { api } from '../../utils/api';
import { Button, Modal, ProgressSteps } from '../common';
import type { ProgressStep } from '../common/ProgressSteps';

const small = '!px-2 !py-1 text-xs';
// Links styled like the Button variants (a button inside a link is invalid).
const linkBase = 'inline-flex items-center justify-center rounded-lg font-medium transition-colors shrink-0';
const linkGhost = `${linkBase} px-2 py-1 text-xs text-gray-600 hover:bg-gray-100`;
const linkPrimary = `${linkBase} px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700`;
const linkSecondary = `${linkBase} px-4 py-2 text-sm bg-white text-gray-700 border border-gray-300 hover:bg-gray-50`;

function when(iso: string | null, timeZone: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      className={small}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked; the text is on screen to select.
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/**
 * For a meeting only Zoom recorded: its summary, the recording to download,
 * and a guided upload to Avoma (Avoma has no upload API, so the upload itself
 * happens in Avoma's web app).
 */
export function ZoomOnlyActions({ recording, meetingTitle, attendees, timezone }: {
  recording: Recording;
  /** The calendar meeting it matched, if any — a better title for Avoma. */
  meetingTitle?: string;
  attendees?: string[];
  timezone: string;
}) {
  const [summary, setSummary] = useState<ZoomSummary | null>(recording.summary || null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [uploading, setUploading] = useState(false);

  const hasMedia = (recording.files || []).some(f => f.fileType === 'MP4' || f.fileType === 'M4A');
  const downloadUrl = api.zoomDownloadUrl(recording.id);
  const title = meetingTitle || recording.title;

  const summarize = async (refresh = false) => {
    setOpen(true);
    if (summary && !refresh) return;
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
        // best-effort
      }
    }, 1500);
    try {
      setSummary((await api.zoomSummary(recording.id, refresh, progressId)).summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finished = true;
      clearInterval(poll);
      setBusy(false);
    }
  };

  const details = [
    `Title: ${title}`,
    `Date: ${when(recording.start, timezone)}`,
    attendees?.length ? `Attendees: ${attendees.join(', ')}` : null,
  ].filter(Boolean).join('\n');

  return (
    <>
      <div className="inline-flex flex-wrap gap-1">
        <Button variant="ghost" className={small} onClick={() => (open ? setOpen(false) : summarize())}>
          {open ? 'Hide summary' : summary ? 'Summary' : 'Summarize'}
        </Button>
        {hasMedia && (
          <a href={downloadUrl} className={linkGhost}>Download</a>
        )}
        {hasMedia && (
          <Button variant="ghost" className={small} onClick={() => setUploading(true)}>Upload to Avoma</Button>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-left">
          {busy && <ProgressSteps steps={steps} startedAt={startedAt} idleLabel="Summarizing…" />}
          {error && <div className="rounded bg-red-50 text-red-700 px-2 py-1 text-xs">{error}</div>}
          {summary && !busy && (
            <>
              <pre className="whitespace-pre-wrap break-words font-sans text-gray-800">{summary.text}</pre>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-400">
                <span>
                  {summary.source === 'zoom'
                    ? "Zoom AI Companion's summary"
                    : `Summarized from Zoom's transcript by Claude · $${summary.costUsd.toFixed(3)}`}
                  {summary.zoomSummaryUnavailable && ` · no Zoom summary: ${summary.zoomSummaryUnavailable}`}
                </span>
                <span className="inline-flex gap-1">
                  <CopyButton text={summary.text} />
                  <Button variant="ghost" className={small} onClick={() => summarize(true)}>Redo</Button>
                </span>
              </div>
            </>
          )}
        </div>
      )}

      <Modal isOpen={uploading} onClose={() => setUploading(false)} title="Upload this recording to Avoma" size="wide">
        <div className="space-y-4 text-sm text-gray-700">
          <p className="text-xs text-gray-500">
            Avoma's API can't receive recordings, so the upload happens in Avoma's web app. Once uploaded,
            Avoma transcribes it and writes its notes — and it will then show up here like any other Avoma meeting.
          </p>
          <ol className="space-y-4 list-decimal pl-5">
            <li>
              <div className="flex items-center justify-between gap-2">
                <span>Download the recording from Zoom.</span>
                <a href={downloadUrl} className={linkPrimary}>Download</a>
              </div>
            </li>
            <li>
              <div className="flex items-center justify-between gap-2">
                <span>
                  Open Avoma's <strong>Meetings</strong> page and click the <strong>Upload Recording</strong> icon,
                  then choose the file you just downloaded.
                </span>
                <a href="https://app.avoma.com/meetings" target="_blank" rel="noreferrer" className={linkSecondary}>
                  Open Avoma
                </a>
              </div>
            </li>
            <li>
              <div className="flex items-center justify-between gap-2">
                <span>Fill in the meeting details:</span>
                <CopyButton text={details} />
              </div>
              <pre className="mt-1 whitespace-pre-wrap rounded-md bg-gray-50 border border-gray-200 p-2 font-sans text-xs">{details}</pre>
            </li>
          </ol>
          <p className="text-[11px] text-gray-400">
            Avoma accepts mp4, avi, mkv, mp3 and wav.{' '}
            <a className="underline" href="https://help.avoma.com/uploading-meeting-recordings" target="_blank" rel="noreferrer">
              Avoma's guide to uploading
            </a>
          </p>
        </div>
      </Modal>
    </>
  );
}
