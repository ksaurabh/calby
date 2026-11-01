import { useState } from 'react';
import type { IntegrationStatus, Org } from '../../types';
import { api } from '../../utils/api';
import { formatDate } from '../../utils/format';
import { Button } from '../common';

const inputClass =
  'flex-1 min-w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

interface ServiceConfig {
  key: 'avoma' | 'gong';
  label: string;
  where: string;
  fields: { name: string; placeholder: string }[];
}

const SERVICES: ServiceConfig[] = [
  {
    key: 'avoma',
    label: 'Avoma',
    where: 'Avoma → Settings → Integrations → API. Needs access to meetings.',
    fields: [{ name: 'API key', placeholder: 'Avoma API key' }],
  },
  {
    key: 'gong',
    label: 'Gong',
    where: 'Gong → Company settings → Ecosystem → API: create an access key and secret.',
    fields: [
      { name: 'Access key', placeholder: 'Access key' },
      { name: 'Secret', placeholder: 'Access key secret' },
    ],
  },
];

function ServiceRow({ org, service, status, onChanged }: {
  org: Org;
  service: ServiceConfig;
  status: IntegrationStatus | undefined;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<string[]>(service.fields.map(() => ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [first, second] = values.map(v => v.trim());
      if (service.key === 'avoma') await api.setOrgAvoma(org.id, first);
      else await api.setOrgGong(org.id, first, second);
      setValues(service.fields.map(() => ''));
      setEditing(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Disconnect ${service.label} for ${org.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeOrgIntegration(org.id, service.key);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-2">
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm mb-2">{error}</div>}
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <label className="block text-xs font-medium text-gray-700">
            {service.label} for everyone at {org.domain || 'this organization'}
          </label>
          <div className="flex gap-2 flex-wrap">
            {service.fields.map((field, i) => (
              <input
                key={field.name}
                className={inputClass}
                type="password"
                placeholder={field.placeholder}
                aria-label={field.name}
                value={values[i]}
                onChange={e => setValues(v => v.map((x, j) => (j === i ? e.target.value : x)))}
                required
                autoFocus={i === 0}
              />
            ))}
            <Button type="submit" disabled={busy || values.some(v => !v.trim())}>
              {busy ? 'Verifying…' : 'Connect'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setEditing(false); setValues(service.fields.map(() => '')); setError(null); }}
            >
              Cancel
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            {service.where} Checked against {service.label} before saving, stored encrypted, never shown again.
          </p>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs">
            {status?.connected ? (
              <>
                <span className="text-gray-700 font-medium">{service.label} connected</span>
                <span className="text-gray-500">
                  {' '}· <code className="font-mono">{status.hint}</code>
                  {status.setBy && ` · by ${status.setBy}`}
                  {status.setAt && ` on ${formatDate(status.setAt)}`}
                </span>
              </>
            ) : (
              <span className="text-gray-500">{service.label} not connected.</span>
            )}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => setEditing(true)}>
              {status?.connected ? 'Replace' : `Connect ${service.label}`}
            </Button>
            {status?.connected && <Button variant="ghost" onClick={remove} disabled={busy}>Disconnect</Button>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The org's Avoma and Gong connections, shared by everyone on its domain —
 * used to find each meeting's recording.
 */
export function OrgIntegrations({ org, onChanged }: { org: Org; onChanged: () => void }) {
  return (
    <div className="mt-2 border-t border-gray-100 pt-1 divide-y divide-gray-50">
      {SERVICES.map(service => (
        <ServiceRow key={service.key} org={org} service={service} status={org[service.key]} onChanged={onChanged} />
      ))}
    </div>
  );
}
