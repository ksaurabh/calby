import { useCallback, useEffect, useState } from 'react';
import type { VirtualAssistant } from '../../types';
import { api } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { Button } from '../common';

const API_URL = import.meta.env.VITE_API_URL || '';

const inputClass =
  'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

const STATUS_STYLES: Record<string, string> = {
  replied: 'bg-green-50 text-green-700',
  ignored: 'bg-gray-100 text-gray-600',
  error: 'bg-red-50 text-red-700',
};

// Google sends the admin back to /admin?va=connected|failed&detail=… after the
// Gmail consent screen. Read it once and clear it from the address bar.
function takeConnectResult(): { ok: boolean; message: string } | null {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('va');
  if (!status) return null;
  const detail = params.get('detail');
  window.history.replaceState({}, '', window.location.pathname);
  return status === 'connected'
    ? { ok: true, message: 'Gmail connected. The assistant will start answering new email within a minute.' }
    : { ok: false, message: `Could not connect Gmail${detail ? `: ${detail}` : '.'}` };
}

export function VirtualAssistants() {
  const [assistants, setAssistants] = useState<VirtualAssistant[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [connectResult] = useState(takeConnectResult);
  const [notice, setNotice] = useState<string | null>(connectResult?.ok ? connectResult.message : null);
  const [error, setError] = useState<string | null>(connectResult && !connectResult.ok ? connectResult.message : null);

  const load = useCallback(async () => {
    try {
      const data = await api.listVirtualAssistants();
      setAssistants(data.assistants);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const replace = (updated: VirtualAssistant) =>
    setAssistants(list => list.map(a => (a.id === updated.id ? updated : a)));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await api.createVirtualAssistant({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
      });
      setAssistants(list => [...list, created]);
      setFirstName('');
      setLastName('');
      setEmail('');
      setNotice(`${created.firstName} created. Now connect Gmail, signing in as ${created.email}.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const connect = (assistant: VirtualAssistant) => {
    window.location.assign(`${API_URL}/api/virtual-assistants/${assistant.id}/connect`);
  };

  const disconnect = async (assistant: VirtualAssistant) => {
    if (!window.confirm(`Disconnect ${assistant.email}? It will stop answering email.`)) return;
    setError(null);
    try {
      replace(await api.disconnectVirtualAssistant(assistant.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (assistant: VirtualAssistant) => {
    if (!window.confirm(`Remove ${assistant.firstName} (${assistant.email})?`)) return;
    setError(null);
    try {
      await api.deleteVirtualAssistant(assistant.id);
      setAssistants(list => list.filter(a => a.id !== assistant.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const checkNow = async (assistant: VirtualAssistant) => {
    setError(null);
    setNotice(null);
    setBusyId(assistant.id);
    try {
      const { result, assistant: updated } = await api.checkVirtualAssistant(assistant.id);
      replace(updated);
      setExpanded(assistant.id);
      if (result.error) setError(result.error);
      else if (result.skipped) setNotice(`Already checking ${assistant.email}.`);
      else setNotice(`Checked ${assistant.email}: ${result.replied ?? 0} replied.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-6 pb-4">
        <h2 className="font-semibold text-gray-900">Virtual assistants</h2>
        <p className="text-sm text-gray-500 mt-1">
          A Google account colleagues can email with a request. It reads its inbox and replies in
          the same thread, with access to the sender's own calendar and booking links. It only
          answers Calby users on your domain, and only ever replies to the sender.
        </p>

        {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm mt-4">{error}</div>}
        {notice && <div className="rounded-lg bg-green-50 text-green-800 px-4 py-3 text-sm mt-4">{notice}</div>}

        <form onSubmit={create} className="flex flex-wrap gap-2 mt-4">
          <input
            className={inputClass}
            placeholder="First name"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            required
          />
          <input
            className={inputClass}
            placeholder="Last name"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
          />
          <input
            className={inputClass}
            type="email"
            placeholder="assistant@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <Button type="submit">Add assistant</Button>
        </form>
        <p className="text-xs text-gray-400 mt-2">
          Create the Google account first. After adding it here, click Connect Gmail and sign in as
          that account to let Calby read and send its email.
        </p>
      </div>

      {assistants.length > 0 && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {assistants.map(a => (
            <li key={a.id} className="px-6 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900">
                    {a.firstName} {a.lastName}
                    <span
                      className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                        a.connected ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {a.connected ? 'Connected' : 'Gmail not connected'}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">{a.email}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Answers {a.ownerDomain} users
                    {a.lastCheckedAt ? ` · last checked ${formatDateTime(a.lastCheckedAt)}` : ''}
                  </div>
                  {a.lastError && <div className="text-xs text-red-600 mt-1">{a.lastError}</div>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {a.connected ? (
                    <>
                      <Button variant="secondary" onClick={() => checkNow(a)} disabled={busyId === a.id}>
                        {busyId === a.id ? 'Checking…' : 'Check inbox now'}
                      </Button>
                      <Button variant="ghost" onClick={() => disconnect(a)}>Disconnect</Button>
                    </>
                  ) : (
                    <Button onClick={() => connect(a)}>Connect Gmail</Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                  >
                    {expanded === a.id ? 'Hide activity' : `Activity (${a.activity.length})`}
                  </Button>
                  <Button variant="ghost" onClick={() => remove(a)}>Remove</Button>
                </div>
              </div>

              {expanded === a.id && (
                <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
                  {a.activity.length === 0 ? (
                    <p className="text-gray-500">No email handled yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {a.activity.map((entry, i) => (
                        <li key={`${entry.at}-${i}`} className="flex flex-wrap items-baseline gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLES[entry.status]}`}>
                            {entry.status}
                          </span>
                          <span className="text-gray-500 text-xs">{formatDateTime(entry.at)}</span>
                          {entry.from && <span className="text-gray-700">{entry.from}</span>}
                          {entry.subject && <span className="text-gray-500 truncate">“{entry.subject}”</span>}
                          {entry.detail && <span className="text-gray-500 w-full text-xs">{entry.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
