import { useEffect, useState } from 'react';
import type { LlmTrace } from '../../types';
import { api } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { Button, Modal } from '../common';

interface TraceModalProps {
  sessionId: string;
  index: number;
  version: number;
  onClose: () => void;
}

// Message content is a string for our calls, but the API also allows blocks.
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(content, null, 2);
}

const preClass =
  'whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-96 overflow-y-auto';

/**
 * The full trace of one chat response: the exact request body sent to the
 * model (system prompt, context, conversation) and what came back.
 */
export function TraceModal({ sessionId, index, version, onClose }: TraceModalProps) {
  const [trace, setTrace] = useState<LlmTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.chatTrace(sessionId, index, version)
      .then(t => { if (!cancelled) setTrace(t); })
      .catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [sessionId, index, version]);

  const requestJson = trace ? JSON.stringify(trace.request, null, 2) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(requestJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the JSON is still on screen to select.
    }
  };

  const usage = trace?.response.usage || {};
  const n = (key: string) => Number(usage[key] || 0).toLocaleString();
  const usd = (value: number) =>
    value === 0 ? '$0' : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;
  const cost = trace?.cost;
  const cached = Number(usage.cache_read_input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0) > 0;

  return (
    <Modal isOpen onClose={onClose} title={`Full trace — version ${version + 1}`} size="full">
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
      {!trace && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {trace && (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><dt className="text-xs text-gray-500">Model</dt><dd className="font-mono">{trace.request.model}</dd></div>
            <div><dt className="text-xs text-gray-500">max_tokens</dt><dd className="font-mono">{trace.request.max_tokens}</dd></div>
            <div><dt className="text-xs text-gray-500">Sent</dt><dd>{formatDateTime(trace.at)}</dd></div>
            <div><dt className="text-xs text-gray-500">Took</dt><dd>{(trace.durationMs / 1000).toFixed(1)}s</dd></div>
            <div><dt className="text-xs text-gray-500">Input tokens</dt><dd>{n('input_tokens')}</dd></div>
            <div><dt className="text-xs text-gray-500">Output tokens</dt><dd>{n('output_tokens')}</dd></div>
            <div><dt className="text-xs text-gray-500">Stop reason</dt><dd className="font-mono">{trace.response.stop_reason}</dd></div>
            <div><dt className="text-xs text-gray-500">API key</dt><dd>{trace.keySource || '—'}</dd></div>
          </dl>

          {cost && (
            <div className="rounded-lg border border-gray-200 p-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-xs text-gray-500 mr-2">Cost of this call</span>
                <span className="text-xl font-semibold text-gray-900">{usd(cost.totalUsd)}</span>
              </div>
              <div className="text-gray-600">
                input {usd(cost.inputUsd)} <span className="text-gray-400">({n('input_tokens')} × ${cost.pricePerMillion.input}/M)</span>
              </div>
              <div className="text-gray-600">
                output {usd(cost.outputUsd)} <span className="text-gray-400">({n('output_tokens')} × ${cost.pricePerMillion.output}/M)</span>
              </div>
              {cached && (
                <div className="text-gray-600">
                  cache write {usd(cost.cacheWriteUsd)} ({n('cache_creation_input_tokens')}) · cache read {usd(cost.cacheReadUsd)} ({n('cache_read_input_tokens')})
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Request sent to the model</h3>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setRaw(r => !r)}>
                {raw ? 'Readable view' : 'Raw JSON'}
              </Button>
              <Button variant="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy JSON'}</Button>
            </div>
          </div>

          {raw ? (
            <pre className={`${preClass} max-h-[60vh]`}>{requestJson}</pre>
          ) : (
            <div className="space-y-4">
              {trace.request.system.map((block, i) => (
                <div key={`s${i}`}>
                  <div className="text-xs font-medium uppercase tracking-wide text-purple-700 mb-1">
                    system [{i}] · {block.text.length.toLocaleString()} chars
                  </div>
                  <pre className={preClass}>{block.text}</pre>
                </div>
              ))}
              {trace.request.messages.map((m, i) => (
                <div key={`m${i}`}>
                  <div
                    className={`text-xs font-medium uppercase tracking-wide mb-1 ${
                      m.role === 'user' ? 'text-blue-700' : 'text-green-700'
                    }`}
                  >
                    messages [{i}] · {m.role}
                  </div>
                  <pre className={preClass}>{contentText(m.content)}</pre>
                </div>
              ))}
            </div>
          )}

          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Response from the model</h3>
            <pre className={preClass}>{JSON.stringify(trace.response, null, 2)}</pre>
          </div>
        </div>
      )}
    </Modal>
  );
}
