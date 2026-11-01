import { useEffect, useState } from 'react';
import type { IntegrationStatus } from '../../types';
import { api } from '../../utils/api';
import { formatDate } from '../../utils/format';
import { Button } from '../common';

type Statuses = { avoma: IntegrationStatus; gong: IntegrationStatus };

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
    where: 'Avoma → Settings → Integrations → API.',
    fields: [{ name: 'API key', placeholder: 'Avoma API key' }],
  },
  {
    key: 'gong',
    label: 'Gong',
    where: 'Gong → Company settings → Ecosystem → API: an access key and its secret.',
    fields: [
      { name: 'Access key', placeholder: 'Access key' },
      { name: 'Secret', placeholder: 'Access key secret' },
    ],
  },
];

function ServiceRow({ service, status, onChange }: {
  service: ServiceConfig;
  status: IntegrationStatus | undefined;
  onChange: (next: Statuses) => void;
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
      onChange(service.key === 'avoma' ? await api.setAvoma(first) : await api.setGong(first, second));
      setValues(service.fields.map(() => ''));
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Disconnect ${service.label}?`)) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.removeIntegration(service.key));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-3">
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm mb-2">{error}</div>}
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">{service.label}</label>
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
            {service.where} Checked against {service.label} before saving, stored encrypted, and never shown again.
          </p>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <span className="font-medium text-gray-900">{service.label}</span>
            {status?.connected ? (
              <span className="text-gray-500">
                {' '}· connected · <code className="font-mono text-xs">{status.hint}</code>
                {status.setAt && ` · since ${formatDate(status.setAt)}`}
              </span>
            ) : (
              <span className="text-gray-500"> · not connected</span>
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
 * Your own Avoma and Gong connections, used by the Recordings page to find
 * each meeting's recording. Personal: nobody else's recordings use them.
 */
export function RecordingIntegrations() {
  const [statuses, setStatuses] = useState<Statuses | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.integrations().then(setStatuses).catch(e => setError((e as Error).message));
  }, []);

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="font-semibold text-gray-900">Recording integrations</h2>
      <p className="text-sm text-gray-500 mt-1">
        Your own Avoma and Gong API keys, used on the Recordings page to find each meeting's recording.
        Only you use them.
      </p>
      {error && <div className="mt-3 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}
      <div className="mt-2 divide-y divide-gray-100">
        {SERVICES.map(service => (
          <ServiceRow key={service.key} service={service} status={statuses?.[service.key]} onChange={setStatuses} />
        ))}
      </div>
    </section>
  );
}
