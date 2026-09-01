import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { User } from '../../types';
import { api } from '../../utils/api';
import { Button } from '../common';

export function AdminPage() {
  const { isSuperAdmin, user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [alwaysAllowed, setAlwaysAllowed] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ users }, domainData] = await Promise.all([api.listUsers(), api.listDomains()]);
      setUsers(users);
      setDomains(domainData.domains);
      setAlwaysAllowed(domainData.alwaysAllowed);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Initial load; state is updated asynchronously after the fetches resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const addDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const data = await api.addDomain(newDomain.trim().toLowerCase());
      setDomains(data.domains);
      setNewDomain('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeDomain = async (domain: string) => {
    setError(null);
    try {
      const data = await api.removeDomain(domain);
      setDomains(data.domains);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setRole = async (email: string, role: 'user' | 'admin') => {
    setError(null);
    try {
      await api.setUserRole(email, role);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Administration</h1>

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900">Allowed email domains</h2>
        <p className="text-sm text-gray-500 mt-1">
          Anyone with a Google account on these domains can sign in.
        </p>

        <div className="flex flex-wrap gap-2 mt-4">
          {alwaysAllowed.map(domain => (
            <span key={domain} className="px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-sm">
              {domain} <span className="text-xs text-gray-400">(built-in)</span>
            </span>
          ))}
          {domains.map(domain => (
            <span key={domain} className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm flex items-center gap-2">
              {domain}
              {isSuperAdmin && (
                <button
                  onClick={() => removeDomain(domain)}
                  className="text-blue-400 hover:text-blue-700"
                  aria-label={`Remove ${domain}`}
                >
                  &times;
                </button>
              )}
            </span>
          ))}
        </div>

        {isSuperAdmin && (
          <form onSubmit={addDomain} className="flex gap-2 mt-4">
            <input
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="example.com"
              value={newDomain}
              onChange={e => setNewDomain(e.target.value)}
              required
            />
            <Button type="submit">Add domain</Button>
          </form>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-6 pb-4">
          <h2 className="font-semibold text-gray-900">Users</h2>
          <p className="text-sm text-gray-500 mt-1">{users.length} have signed in.</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Email</th>
              <th className="px-6 py-3 font-medium">Role</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.email} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">{u.name}</td>
                <td className="px-6 py-3 text-gray-600">{u.email}</td>
                <td className="px-6 py-3 text-gray-600">
                  {u.role === 'super_admin' ? 'Super Admin' : u.role === 'admin' ? 'Admin' : 'Member'}
                </td>
                <td className="px-6 py-3 text-right">
                  {isSuperAdmin && u.role !== 'super_admin' && u.email !== currentUser?.email && (
                    <Button
                      variant="ghost"
                      onClick={() => setRole(u.email, u.role === 'admin' ? 'user' : 'admin')}
                    >
                      {u.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
