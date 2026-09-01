import { useState } from 'react';
import type { EventType } from '../../types';
import { browserTimezone } from '../../utils/format';
import { Button } from '../common';

interface EventTypeFormProps {
  eventType?: EventType;
  onSubmit: (values: {
    name: string;
    externalName: string;
    description: string;
    guidance: string;
    timezone: string;
  }) => Promise<void>;
  onCancel: () => void;
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

const EXAMPLES = [
  '30 minute intro calls, weekdays 9am–5pm, next 2 weeks',
  '60 minute deep dives, Tuesday and Thursday afternoons only, 24 hours notice',
  'Half hour syncs, mornings, no Fridays, 15 minute gap between calls',
];

export function EventTypeForm({ eventType, onSubmit, onCancel }: EventTypeFormProps) {
  const [name, setName] = useState(eventType?.name || '');
  const [externalName, setExternalName] = useState(eventType?.externalName || '');
  const [description, setDescription] = useState(eventType?.description || '');
  const [guidance, setGuidance] = useState(eventType?.guidance || '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        // Blank external name means "same as internal".
        externalName: externalName.trim() || name.trim(),
        description: description.trim(),
        guidance: guidance.trim(),
        timezone: eventType?.rules.timezone || browserTimezone(),
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Internal name <span className="text-gray-400 font-normal">(only you see this)</span>
        </label>
        <input
          className={inputClass}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Inbound lead — 30m"
          required
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          External name <span className="text-gray-400 font-normal">(shown to whoever books)</span>
        </label>
        <input
          className={inputClass}
          value={externalName}
          onChange={e => setExternalName(e.target.value)}
          placeholder={name.trim() || 'Intro call'}
        />
        <p className="text-xs text-gray-500 mt-1">
          Appears on the booking page and in the calendar invite. Leave blank to use
          the internal name.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description <span className="text-gray-400 font-normal">(shown on the booking page)</span>
        </label>
        <input
          className={inputClass}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="A quick chat about what you're working on"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Availability guidance</label>
        <textarea
          className={`${inputClass} min-h-28`}
          value={guidance}
          onChange={e => setGuidance(e.target.value)}
          placeholder="Describe when people may book you, in plain English."
          required
        />
        <p className="text-xs text-gray-500 mt-2">
          Written in plain English — the scheduling agent reads this and works out the
          meeting length, days, hours and notice period, then checks your calendar for
          what is actually free.
        </p>
        <div className="mt-2 space-y-1">
          {EXAMPLES.map(example => (
            <button
              key={example}
              type="button"
              onClick={() => setGuidance(example)}
              className="block text-left text-xs text-blue-600 hover:text-blue-800"
            >
              “{example}”
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Reading your guidance…' : eventType ? 'Save changes' : 'Create event type'}
        </Button>
      </div>
    </form>
  );
}
