import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantChatSession, AssistantChatSummary, ChatAssistant } from '../../types';
import { api } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { navigate } from '../../utils/navigate';
import { Button, ResizeHandle, useResizableWidth } from '../common';
import { TraceModal } from './TraceModal';

const fullName = (a: { firstName: string; lastName: string }) => `${a.firstName} ${a.lastName}`.trim();

const usd = (value: number) =>
  value === 0 ? '$0' : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;

/**
 * Chat with your virtual assistant. Each message is answered with the same
 * prompt and context as an email to it, so this shows what it would reply.
 */
export function ChatPage() {
  const [assistants, setAssistants] = useState<ChatAssistant[]>([]);
  const [assistantId, setAssistantId] = useState<string>('');
  const [sessions, setSessions] = useState<AssistantChatSummary[]>([]);
  const [active, setActive] = useState<AssistantChatSession | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  // Which response is regenerating, and which response/version's trace is open.
  const [regenerating, setRegenerating] = useState<number | null>(null);
  const [traceOf, setTraceOf] = useState<{ index: number; version: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionsPanel = useResizableWidth('calby:chat-sessions-width', 256, 180, 600);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([api.chatAssistants(), api.listChatSessions()]);
      setAssistants(a.assistants);
      setAssistantId(id => id || a.assistants[0]?.id || '');
      setSessions(s.sessions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const scrollToEnd = () =>
    window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });

  const summarize = (s: AssistantChatSession): AssistantChatSummary => {
    const { messages, ...rest } = s;
    return { ...rest, messageCount: messages.length };
  };

  const upsertSummary = (s: AssistantChatSession) =>
    setSessions(list => [summarize(s), ...list.filter(x => x.id !== s.id)]);

  const newChat = async () => {
    setError(null);
    try {
      const session = await api.createChatSession(assistantId || undefined);
      setActive(session);
      upsertSummary(session);
      inputRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const open = async (id: string) => {
    setError(null);
    try {
      setActive(await api.chatSession(id));
      scrollToEnd();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (s: AssistantChatSummary) => {
    if (!window.confirm(`Delete "${s.title}"?`)) return;
    try {
      await api.deleteChatSession(s.id);
      setSessions(list => list.filter(x => x.id !== s.id));
      if (active?.id === s.id) setActive(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || pending || regenerating !== null || !active) return;
    setError(null);
    setPending(text);
    setDraft('');
    scrollToEnd();
    try {
      const updated = await api.sendChatMessage(active.id, text);
      setActive(updated);
      upsertSummary(updated);
      scrollToEnd();
    } catch (err) {
      setError((err as Error).message);
      setDraft(text);
    } finally {
      setPending(null);
    }
  };

  const regenerate = async (index: number) => {
    if (!active || regenerating !== null || pending) return;
    setError(null);
    setRegenerating(index);
    try {
      const updated = await api.regenerateChatMessage(active.id, index);
      setActive(updated);
      upsertSummary(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegenerating(null);
    }
  };

  const showVersion = async (index: number, version: number) => {
    if (!active) return;
    setError(null);
    try {
      setActive(await api.selectChatVersion(active.id, index, version));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  if (!assistants.length) {
    return (
      <div className="space-y-4 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">Chat</h1>
        {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-600">
          No virtual assistant is set up for your domain yet. An admin can add one on the
          Administration page.
        </div>
      </div>
    );
  }

  const activeAssistant = assistants.find(a => a.id === active?.assistantId);

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chat</h1>
          <p className="text-sm text-gray-500 mt-1">
            Ask your virtual assistant anything. It answers exactly as it would by email, using your
            calendar, booking links and{' '}
            <button className="text-blue-600 hover:underline" onClick={() => navigate('/notes')}>
              notes
            </button>.
          </p>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <div className="flex-1 min-h-0 flex">
        {/* Sessions */}
        <aside
          className="shrink-0 bg-white rounded-xl border border-gray-200 flex flex-col min-h-0"
          style={{ width: sessionsPanel.width }}
        >
          <div className="p-3 border-b border-gray-100 space-y-2">
            {assistants.length > 1 && (
              <select
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                value={assistantId}
                onChange={e => setAssistantId(e.target.value)}
              >
                {assistants.map(a => (
                  <option key={a.id} value={a.id}>{fullName(a)}</option>
                ))}
              </select>
            )}
            <Button className="w-full" onClick={newChat}>+ New chat</Button>
          </div>
          <ul className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 && <li className="text-xs text-gray-400 p-2">No chats yet.</li>}
            {sessions.map(s => (
              <li key={s.id} className="group relative">
                <button
                  onClick={() => open(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                    active?.id === s.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <div className="truncate pr-5">{s.title}</div>
                  <div className="text-xs text-gray-400 truncate">
                    {s.assistantName} · {formatDateTime(s.updatedAt)}
                  </div>
                </button>
                <button
                  onClick={() => remove(s)}
                  className="absolute right-2 top-2 text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100"
                  aria-label={`Delete ${s.title}`}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <ResizeHandle label="Resize chat list" className="mx-0.5" {...sessionsPanel.handleProps} />

        {/* Conversation */}
        <section className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 flex flex-col min-h-0">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-500 p-6 text-center">
              Start a new chat, or pick one on the left.
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="font-medium text-gray-900">{active.assistantName}</div>
                {activeAssistant && <div className="text-xs text-gray-500">{activeAssistant.email}</div>}
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
                {active.messages.length === 0 && !pending && (
                  <p className="text-sm text-gray-400">
                    Say hello, or try "What's on my calendar tomorrow?"
                  </p>
                )}
                {active.messages.map((m, i) => {
                  if (m.role === 'user') {
                    return (
                      <div key={i} className="flex justify-end">
                        <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words bg-blue-600 text-white">
                          {m.content}
                        </div>
                      </div>
                    );
                  }
                  const versions = m.versions || [];
                  const version = m.version ?? versions.length - 1;
                  const busyHere = regenerating === i;
                  return (
                    <div key={i} className="flex flex-col items-start">
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words bg-gray-100 text-gray-800 ${
                          busyHere ? 'opacity-50' : ''
                        }`}
                      >
                        {m.content}
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                        {versions.length > 1 && (
                          <span className="flex items-center gap-1 mr-1">
                            <button
                              className="px-1 hover:text-gray-900 disabled:opacity-30"
                              disabled={version <= 0 || busyHere}
                              onClick={() => showVersion(i, version - 1)}
                              aria-label="Previous version"
                            >
                              ‹
                            </button>
                            {version + 1}/{versions.length}
                            <button
                              className="px-1 hover:text-gray-900 disabled:opacity-30"
                              disabled={version >= versions.length - 1 || busyHere}
                              onClick={() => showVersion(i, version + 1)}
                              aria-label="Next version"
                            >
                              ›
                            </button>
                          </span>
                        )}
                        <button
                          className="px-2 py-0.5 rounded hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
                          disabled={regenerating !== null || !!pending}
                          onClick={() => regenerate(i)}
                        >
                          {busyHere ? 'Regenerating…' : '↻ Regenerate'}
                        </button>
                        {versions[version]?.hasTrace && (
                          <button
                            className="px-2 py-0.5 rounded hover:bg-gray-100 hover:text-gray-900"
                            onClick={() => setTraceOf({ index: i, version })}
                          >
                            Full trace
                          </button>
                        )}
                        {versions[version]?.costUsd != null && (
                          <span className="px-1 text-gray-400" title="What generating this reply cost, across all model calls">
                            {usd(versions[version].costUsd!)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {pending && (
                  <>
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words bg-blue-600 text-white">
                        {pending}
                      </div>
                    </div>
                    <div className="text-sm text-gray-400">{active.assistantName.split(' ')[0]} is writing…</div>
                  </>
                )}
              </div>
              <form onSubmit={send} className="border-t border-gray-100 p-3 flex gap-2">
                <textarea
                  ref={inputRef}
                  className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  rows={2}
                  placeholder="Write a message — Enter to send, Shift+Enter for a new line"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <Button type="submit" disabled={!draft.trim() || !!pending}>Send</Button>
              </form>
            </>
          )}
        </section>
      </div>

      {traceOf && active && (
        <TraceModal
          sessionId={active.id}
          index={traceOf.index}
          version={traceOf.version}
          onClose={() => setTraceOf(null)}
        />
      )}
    </div>
  );
}
