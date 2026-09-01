import { useRef, useState } from 'react';
import type { ChatMessage } from '../../types';
import { api } from '../../utils/api';
import { Button } from '../common';

const SUGGESTIONS = [
  'How many hours of meetings do I have next week?',
  'Which meetings did someone else organize?',
  'What is my longest meeting this week, and who is coming?',
  'Do I have any calls with people outside my company?',
];

/**
 * Question answering over the owner's own calendar. The server renders the
 * entries — titles, times, organizer, guests — into the prompt; the model has no
 * access to anything else.
 */
export function CalendarChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [considered, setConsidered] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const history = messages;
    setMessages([...history, { role: 'user', content: trimmed }]);
    setQuestion('');
    setBusy(true);
    setError(null);

    try {
      const result = await api.askCalendar(trimmed, history);
      setConsidered(result.eventsConsidered);
      setMessages(current => [...current, { role: 'assistant', content: result.answer }]);
      window.requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">Ask about your calendar</h2>
        <p className="text-xs text-gray-500 mt-1">
          Questions are answered from your entries for the last week and the next four —
          titles, times, who organized each one and who was invited.
          {considered !== null && ` ${considered} entries in range.`}
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-48 max-h-96">
        {messages.length === 0 && !error && (
          <div className="space-y-2">
            <p className="text-sm text-gray-500">Try one of these:</p>
            {SUGGESTIONS.map(suggestion => (
              <button
                key={suggestion}
                onClick={() => ask(suggestion)}
                className="block w-full text-left text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-2 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-500 rounded-xl px-3 py-2 text-sm">Reading your calendar…</div>
          </div>
        )}

        {error && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); ask(question); }}
        className="px-5 py-4 border-t border-gray-100 flex gap-2"
      >
        <input
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          placeholder="Ask a question about your calendar…"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !question.trim()}>Ask</Button>
      </form>
    </div>
  );
}
