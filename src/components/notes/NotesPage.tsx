import { useCallback, useEffect, useState } from 'react';
import type { Note } from '../../types';
import { api } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { Button } from '../common';

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

/**
 * Notes are things you want your virtual assistant to know — preferences,
 * facts, standing instructions. Every note is included as context whenever you
 * email or chat with it.
 */
export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [maxChars, setMaxChars] = useState(10_000);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listNotes();
      setNotes(data.notes);
      setMaxChars(data.maxChars);
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

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const note = await api.createNote({ title: title.trim(), body: body.trim() });
      setNotes(list => [note, ...list]);
      setTitle('');
      setBody('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditBody(note.body);
  };

  const saveEdit = async (id: string) => {
    setError(null);
    try {
      const updated = await api.updateNote(id, { title: editTitle.trim(), body: editBody.trim() });
      setNotes(list => [updated, ...list.filter(n => n.id !== id)]);
      setEditingId(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (note: Note) => {
    if (!window.confirm(`Delete "${note.title || note.body.slice(0, 40)}"?`)) return;
    setError(null);
    try {
      await api.deleteNote(note.id);
      setNotes(list => list.filter(n => n.id !== note.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Things your virtual assistant should know: preferences, facts, standing instructions.
          Every note is included whenever you email or chat with your assistant.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <form onSubmit={add} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <input
          className={inputClass}
          placeholder="Title (optional)"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={200}
        />
        <textarea
          className={`${inputClass} min-h-28`}
          placeholder="e.g. I prefer meetings after 10am Pacific. Never book over my Friday focus block."
          value={body}
          onChange={e => setBody(e.target.value)}
          maxLength={maxChars}
          required
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {body.length.toLocaleString()} / {maxChars.toLocaleString()}
          </span>
          <Button type="submit" disabled={!body.trim()}>Add note</Button>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-gray-500">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map(note => (
            <li key={note.id} className="bg-white rounded-xl border border-gray-200 p-5">
              {editingId === note.id ? (
                <div className="space-y-3">
                  <input
                    className={inputClass}
                    placeholder="Title (optional)"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    maxLength={200}
                  />
                  <textarea
                    className={`${inputClass} min-h-28`}
                    value={editBody}
                    onChange={e => setEditBody(e.target.value)}
                    maxLength={maxChars}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    <Button onClick={() => saveEdit(note.id)} disabled={!editBody.trim()}>Save</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {note.title && <h3 className="font-medium text-gray-900">{note.title}</h3>}
                      <p className="text-sm text-gray-700 whitespace-pre-wrap break-words mt-0.5">{note.body}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" onClick={() => startEdit(note)}>Edit</Button>
                      <Button variant="ghost" onClick={() => remove(note)}>Delete</Button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Updated {formatDateTime(note.updatedAt)}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
