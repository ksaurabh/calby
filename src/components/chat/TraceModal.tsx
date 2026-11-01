import { useEffect, useState } from 'react';
import type { LlmCall, LlmTrace } from '../../types';
import { api } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { Button, Modal } from '../common';

interface TraceModalProps {
  sessionId: string;
  index: number;
  version: number;
  onClose: () => void;
}

const preClass =
  'whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-96 overflow-y-auto';

const usd = (value: number) =>
  value === 0 ? '$0' : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;

type Block = {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
};

// Message content is either a string or a list of blocks (text, tool calls,
// tool results). Render each block as it was sent, labelled by type.
function MessageContent({ content }: { content: unknown }) {
  if (typeof content === 'string') return <pre className={preClass}>{content}</pre>;
  if (!Array.isArray(content)) return <pre className={preClass}>{JSON.stringify(content, null, 2)}</pre>;
  return (
    <div className="space-y-2">
      {(content as Block[]).map((block, i) => {
        if (block.type === 'text') return <pre key={i} className={preClass}>{block.text}</pre>;
        if (block.type === 'tool_use') {
          return (
            <div key={i}>
              <div className="text-[11px] font-medium text-amber-700 mb-0.5">tool call · {block.name}</div>
              <pre className={preClass}>{JSON.stringify(block.input, null, 2)}</pre>
            </div>
          );
        }
        if (block.type === 'tool_result') {
          const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2);
          return (
            <div key={i}>
              <div className={`text-[11px] font-medium mb-0.5 ${block.is_error ? 'text-red-700' : 'text-amber-700'}`}>
                tool result{block.is_error ? ' (error)' : ''} · {text.length.toLocaleString()} chars
              </div>
              <pre className={preClass}>{text}</pre>
            </div>
          );
        }
        return <pre key={i} className={preClass}>{JSON.stringify(block, null, 2)}</pre>;
      })}
    </div>
  );
}

function callLabel(call: LlmCall): string {
  const used = (call.response.content as Block[])
    .filter(b => b.type === 'tool_use')
    .map(b => b.name);
  return used.length ? `asked for ${used.join(', ')}` : 'final answer';
}

function CallDetail({ call }: { call: LlmCall }) {
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestJson = JSON.stringify(call.request, null, 2);
  const usage = call.response.usage || {};
  const n = (key: string) => Number(usage[key] || 0).toLocaleString();
  const cost = call.cost;
  const cached = Number(usage.cache_read_input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0) > 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(requestJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the JSON is still on screen to select.
    }
  };

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div><dt className="text-xs text-gray-500">Model</dt><dd className="font-mono">{call.request.model}</dd></div>
        <div><dt className="text-xs text-gray-500">max_tokens</dt><dd className="font-mono">{call.request.max_tokens}</dd></div>
        <div><dt className="text-xs text-gray-500">Sent</dt><dd>{formatDateTime(call.at)}</dd></div>
        <div><dt className="text-xs text-gray-500">Took</dt><dd>{(call.durationMs / 1000).toFixed(1)}s</dd></div>
        <div><dt className="text-xs text-gray-500">Input tokens</dt><dd>{n('input_tokens')}</dd></div>
        <div><dt className="text-xs text-gray-500">Output tokens</dt><dd>{n('output_tokens')}</dd></div>
        <div><dt className="text-xs text-gray-500">Stop reason</dt><dd className="font-mono">{call.response.stop_reason}</dd></div>
        <div><dt className="text-xs text-gray-500">Cost</dt><dd className="font-semibold">{usd(cost.totalUsd)}</dd></div>
      </dl>
      <p className="text-xs text-gray-500 -mt-2">
        input {usd(cost.inputUsd)} ({n('input_tokens')} × ${cost.pricePerMillion.input}/M) · output{' '}
        {usd(cost.outputUsd)} ({n('output_tokens')} × ${cost.pricePerMillion.output}/M)
        {cached &&
          ` · cache write ${usd(cost.cacheWriteUsd)} (${n('cache_creation_input_tokens')}) · cache read ${usd(cost.cacheReadUsd)} (${n('cache_read_input_tokens')})`}
      </p>

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Request sent to the model</h3>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setRaw(r => !r)}>{raw ? 'Readable view' : 'Raw JSON'}</Button>
          <Button variant="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy JSON'}</Button>
        </div>
      </div>

      {raw ? (
        <pre className={`${preClass} max-h-[60vh]`}>{requestJson}</pre>
      ) : (
        <div className="space-y-4">
          {call.request.system.map((block, i) => (
            <div key={`s${i}`}>
              <div className="text-xs font-medium uppercase tracking-wide text-purple-700 mb-1">
                system [{i}] · {block.text.length.toLocaleString()} chars
              </div>
              <pre className={preClass}>{block.text}</pre>
            </div>
          ))}
          {call.request.tools && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-amber-700 mb-1">
                tools · {call.request.tools.map(t => t.name).join(', ')}
                {call.request.tool_choice ? ` · tool_choice ${JSON.stringify(call.request.tool_choice)}` : ''}
              </div>
              <pre className={preClass}>{JSON.stringify(call.request.tools, null, 2)}</pre>
            </div>
          )}
          {call.request.messages.map((m, i) => (
            <div key={`m${i}`}>
              <div
                className={`text-xs font-medium uppercase tracking-wide mb-1 ${
                  m.role === 'user' ? 'text-blue-700' : 'text-green-700'
                }`}
              >
                messages [{i}] · {m.role}
              </div>
              <MessageContent content={m.content} />
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="font-semibold text-gray-900 mb-2">Response from the model</h3>
        <pre className={preClass}>{JSON.stringify(call.response, null, 2)}</pre>
      </div>
    </div>
  );
}

/**
 * The full trace of one chat response: every call made to the model — the
 * exact request body each time, including tool calls and their results — and
 * what came back, with the cost of each.
 */
export function TraceModal({ sessionId, index, version, onClose }: TraceModalProps) {
  const [trace, setTrace] = useState<LlmTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.chatTrace(sessionId, index, version)
      .then(t => { if (!cancelled) setTrace(t); })
      .catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [sessionId, index, version]);

  // Default to the last call — the one that wrote the answer.
  const current = trace ? (selected ?? trace.calls.length - 1) : 0;

  return (
    <Modal isOpen onClose={onClose} title={`Full trace — version ${version + 1}`} size="full">
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
      {!trace && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {trace && (
        <div className="space-y-5">
          <div className="rounded-lg border border-gray-200 p-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-xs text-gray-500 mr-2">Total cost</span>
              <span className="text-xl font-semibold text-gray-900">{usd(trace.totalUsd)}</span>
            </div>
            <div className="text-gray-600">
              {trace.calls.length} model {trace.calls.length === 1 ? 'call' : 'calls'}
            </div>
            <div className="text-gray-600">{(trace.durationMs / 1000).toFixed(1)}s in all</div>
            <div className="text-gray-600">API key: {trace.keySource || '—'}</div>
          </div>

          {trace.calls.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {trace.calls.map((call, i) => (
                <button
                  key={i}
                  onClick={() => setSelected(i)}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${
                    current === i
                      ? 'bg-blue-50 border-blue-300 text-blue-800'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Call {i + 1} · {callLabel(call)} · {usd(call.cost.totalUsd)}
                </button>
              ))}
            </div>
          )}

          <CallDetail key={current} call={trace.calls[current]} />
        </div>
      )}
    </Modal>
  );
}
