import { useEffect, useState } from 'react';
import type { IntegrationStatus } from '../../types';
import { api } from '../../utils/api';
import { formatDate } from '../../utils/format';
import { Button } from '../common';

type ServiceKey = 'avoma' | 'gong' | 'zoom';
type Statuses = Record<ServiceKey, IntegrationStatus>;

const inputClass =
  'flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';
const smallButton = '!px-2 !py-1 text-xs';

interface Field {
  /** The property name the server uses for it. */
  key: string;
  name: string;
  placeholder: string;
  optional?: boolean;
  /** Not a secret: shown in clear. */
  plain?: boolean;
}

interface ServiceConfig {
  key: ServiceKey;
  label: string;
  where: string;
  fields: Field[];
}

const SERVICES: ServiceConfig[] = [
  {
    key: 'avoma',
    label: 'Avoma',
    where: 'Avoma → Settings → Integrations → API.',
    fields: [{ key: 'apiKey', name: 'API key', placeholder: 'Avoma API key' }],
  },
  {
    key: 'gong',
    label: 'Gong',
    where: 'Gong → Company settings → Ecosystem → API: an access key and its secret.',
    fields: [
      { key: 'accessKey', name: 'Access key', placeholder: 'Access key' },
      { key: 'secretKey', name: 'Secret', placeholder: 'Access key secret' },
    ],
  },
  {
    key: 'zoom',
    label: 'Zoom',
    where: 'Zoom App Marketplace → Develop → Build app → Server-to-Server OAuth, with the scope "View all user recordings" (cloud_recording:read:list_user_recordings:admin); copy the account ID, client ID and secret, and activate the app.',
    fields: [
      { key: 'accountId', name: 'Account ID', placeholder: 'Account ID', plain: true },
      { key: 'clientId', name: 'Client ID', placeholder: 'Client ID', plain: true },
      { key: 'clientSecret', name: 'Client secret', placeholder: 'Client secret' },
      { key: 'userEmail', name: 'Zoom user email', placeholder: 'Zoom user email (defaults to yours)', optional: true, plain: true },
    ],
  },
];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const asLines = (service: ServiceConfig, values: string[]) =>
  service.fields.map((f, i) => `${service.label} ${f.name}: ${values[i] || ''}`).join('\n');

function ServiceRow({ service, status, onChange }: {
  service: ServiceConfig;
  status: IntegrationStatus | undefined;
  onChange: (next: Statuses) => void;
}) {
  const empty = () => service.fields.map(() => '');
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<string[]>(empty);
  const [shown, setShown] = useState<boolean[]>(() => service.fields.map(() => false));
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flash = (what: string) => {
    setCopied(what);
    window.setTimeout(() => setCopied(c => (c === what ? null : c)), 1500);
  };

  // The saved values, fetched only when asked for.
  const saved = async (): Promise<string[]> => {
    const creds = await api.integrationCredentials(service.key);
    return service.fields.map(f => creds[f.key] || '');
  };

  const startEdit = async () => {
    setError(null);
    if (!status?.connected) {
      setValues(empty());
      setEditing(true);
      return;
    }
    setBusy(true);
    try {
      setValues(await saved());
      setShown(service.fields.map(() => false));
      setEditing(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyAll = async (from?: string[]) => {
    setError(null);
    try {
      const text = asLines(service, from ?? (await saved()));
      if (await copyText(text)) flash('all');
      else setError('Your browser blocked copying to the clipboard.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [first, second, third, fourth] = values.map(v => v.trim());
      onChange(
        service.key === 'avoma'
          ? await api.setAvoma(first)
          : service.key === 'gong'
            ? await api.setGong(first, second)
            : await api.setZoom({ accountId: first, clientId: second, clientSecret: third, userEmail: fourth })
      );
      setValues(empty());
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

  const cancel = () => {
    setEditing(false);
    setValues(empty());
    setError(null);
  };

  return (
    <div className="py-3">
      {error && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm mb-2">{error}</div>}
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              {service.label} {status?.connected ? '— edit' : '— connect'}
            </span>
            {status?.connected && (
              <Button type="button" variant="ghost" className={smallButton} onClick={() => copyAll(values)}>
                {copied === 'all' ? 'Copied' : 'Copy all'}
              </Button>
            )}
          </div>
          {service.fields.map((field, i) => (
            <div key={field.key} className="flex items-center gap-2">
              <label className="w-32 shrink-0 text-xs text-gray-600" htmlFor={`${service.key}-${field.key}`}>
                {field.name}
                {field.optional && <span className="text-gray-400"> (optional)</span>}
              </label>
              <input
                id={`${service.key}-${field.key}`}
                className={inputClass}
                type={field.plain || shown[i] ? 'text' : 'password'}
                placeholder={field.placeholder}
                value={values[i]}
                onChange={e => setValues(v => v.map((x, j) => (j === i ? e.target.value : x)))}
                required={!field.optional}
                autoFocus={i === 0}
                autoComplete="off"
                spellCheck={false}
              />
              {!field.plain && (
                <Button
                  type="button"
                  variant="ghost"
                  className={smallButton}
                  onClick={() => setShown(s => s.map((x, j) => (j === i ? !x : x)))}
                >
                  {shown[i] ? 'Hide' : 'Show'}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className={smallButton}
                disabled={!values[i]}
                onClick={async () => {
                  if (await copyText(values[i])) flash(field.key);
                  else setError('Your browser blocked copying to the clipboard.');
                }}
              >
                {copied === field.key ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || values.some((v, i) => !service.fields[i].optional && !v.trim())}>
              {busy ? 'Verifying…' : status?.connected ? 'Save changes' : 'Connect'}
            </Button>
            <Button type="button" variant="secondary" onClick={cancel}>Cancel</Button>
          </div>
          <p className="text-xs text-gray-500">
            {service.where} Checked against {service.label} before saving, and stored encrypted. Only you
            can see these values.
          </p>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <span className="font-medium text-gray-900">{service.label}</span>
            {status?.connected ? (
              <span className="text-gray-500">
                {' '}· connected · <code className="font-mono text-xs">{status.hint}</code>
                {status.userEmail && ` · recordings of ${status.userEmail}`}
                {status.setAt && ` · since ${formatDate(status.setAt)}`}
              </span>
            ) : (
              <span className="text-gray-500"> · not connected</span>
            )}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" onClick={startEdit} disabled={busy}>
              {status?.connected ? (busy ? 'Loading…' : 'Edit') : `Connect ${service.label}`}
            </Button>
            {status?.connected && (
              <>
                <Button variant="ghost" onClick={() => copyAll()} disabled={busy}>
                  {copied === 'all' ? 'Copied' : 'Copy all'}
                </Button>
                <Button variant="ghost" onClick={remove} disabled={busy}>Disconnect</Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Your own Avoma, Gong and Zoom connections, used by the Recordings page to
 * find each meeting's recording. Personal: nobody else's recordings use them.
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
        Your own Avoma, Gong and Zoom credentials, used on the Recordings page to find each meeting's
        recording. Only you use them.
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
