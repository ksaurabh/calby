import { useState } from 'react';
import type { Org } from '../../types';
import { Button } from '../common';

interface OrgFormProps {
  org?: Org;
  onSubmit: (values: { name: string; domain: string }) => Promise<void>;
  onCancel: () => void;
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

export function OrgForm({ org, onSubmit, onCancel }: OrgFormProps) {
  const [name, setName] = useState(org?.name || '');
  const [domain, setDomain] = useState(org?.domain || '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), domain: domain.trim() });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Organization name</label>
        <input
          className={inputClass}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Acme Corp"
          required
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Email domain <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          className={inputClass}
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="acme.com"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : org ? 'Save changes' : 'Create organization'}
        </Button>
      </div>
    </form>
  );
}
