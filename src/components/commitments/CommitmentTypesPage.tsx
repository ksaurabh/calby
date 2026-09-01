import { useCallback, useEffect, useState } from 'react';
import type { CommitmentType } from '../../types';
import { api } from '../../utils/api';
import { Button, Modal } from '../common';

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

const EXAMPLES = [
  { name: 'Customer calls', condition: 'Any meeting with a customer, prospect or partner' },
  { name: 'Internal', condition: 'Team syncs, standups, 1:1s and anything internal' },
  { name: 'Focus time', condition: 'Blocks I hold for deep work, writing or review' },
  { name: 'Personal', condition: 'Appointments, travel, family and time off' },
];

interface FormState {
  id: string | null;
  name: string;
  condition: string;
  color: string;
}

export function CommitmentTypesPage() {
  const [commitmentTypes, setCommitmentTypes] = useState<CommitmentType[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.listCommitmentTypes();
      setCommitmentTypes(data.commitmentTypes);
      setColors(data.colors);
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

  const openNew = (preset?: { name: string; condition: string }) =>
    setForm({
      id: null,
      name: preset?.name || '',
      condition: preset?.condition || '',
      color: colors[commitmentTypes.length % (colors.length || 1)] || '#2563eb',
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { name: form.name.trim(), condition: form.condition.trim(), color: form.color };
      if (form.id) await api.updateCommitmentType(form.id, payload);
      else await api.createCommitmentType(payload);
      setForm(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (commitmentType: CommitmentType) => {
    if (!window.confirm(`Delete "${commitmentType.name}"?`)) return;
    await api.deleteCommitmentType(commitmentType.id);
    await load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Commitment types</h1>
          <p className="text-sm text-gray-500 mt-1">
            Describe the kinds of things on your calendar and give each a colour. The
            availability preview colours your existing entries by whichever condition
            they satisfy.
          </p>
        </div>
        <Button onClick={() => openNew()}>+ New commitment type</Button>
      </div>

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">Loading…</div>
      ) : commitmentTypes.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10">
          <div className="text-center">
            <div className="text-4xl mb-3">🎨</div>
            <h2 className="font-medium text-gray-900">No commitment types yet</h2>
            <p className="text-sm text-gray-500 mt-1">Start from one of these, or write your own.</p>
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map(example => (
              <button
                key={example.name}
                onClick={() => openNew(example)}
                className="text-left border border-gray-200 rounded-lg p-3 hover:border-blue-500 hover:bg-blue-50 transition-colors"
              >
                <div className="text-sm font-medium text-gray-900">{example.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">{example.condition}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {commitmentTypes.map(commitmentType => (
            <div key={commitmentType.id} className="p-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <span
                  className="mt-1 w-4 h-4 rounded shrink-0 border"
                  style={{ backgroundColor: `${commitmentType.color}33`, borderColor: commitmentType.color }}
                />
                <div className="min-w-0">
                  <div className="font-medium text-gray-900">{commitmentType.name}</div>
                  <div className="text-sm text-gray-600 mt-0.5">{commitmentType.condition}</div>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  variant="ghost"
                  onClick={() => setForm({
                    id: commitmentType.id,
                    name: commitmentType.name,
                    condition: commitmentType.condition,
                    color: commitmentType.color,
                  })}
                >
                  Edit
                </Button>
                <Button variant="ghost" onClick={() => remove(commitmentType)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit commitment type' : 'New commitment type'}
      >
        {form && (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                className={inputClass}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Customer calls"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Condition</label>
              <textarea
                className={`${inputClass} min-h-24`}
                value={form.condition}
                onChange={e => setForm({ ...form, condition: e.target.value })}
                placeholder="Any meeting with a customer, prospect or partner"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Plain English. A calendar entry is coloured with this type when it
                satisfies the condition.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Colour</label>
              <div className="flex flex-wrap gap-2">
                {colors.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setForm({ ...form, color })}
                    aria-label={`Use colour ${color}`}
                    className={`w-8 h-8 rounded-lg border-2 transition-transform ${
                      form.color === color ? 'scale-110 ring-2 ring-offset-1 ring-gray-400' : ''
                    }`}
                    style={{ backgroundColor: `${color}33`, borderColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : form.id ? 'Save changes' : 'Create'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
