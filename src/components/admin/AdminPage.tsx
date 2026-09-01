import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { User } from '../../types';
import { api } from '../../utils/api';
import { formatDate } from '../../utils/format';
import { ROLE_LABELS } from '../../utils/roles';
import { Button } from '../common';

const inputClass =
  'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

export function AdminPage() {
  const { isAdmin, isSuperAdmin, orgAdminOf, user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [scopedToDomains, setScopedToDomains] = useState<string[] | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [alwaysAllowed, setAlwaysAllowed] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const userData = await api.listUsers();
      setUsers(userData.users);
      setScopedToDomains(userData.scopedToDomains);
      // The domain list is admin-only; org admins simply don't see that section.
      if (isAdmin) {
        const domainData = await api.listDomains();
        setDomains(domainData.domains);
        setAlwaysAllowed(domainData.alwaysAllowed);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [isAdmin]);

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

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await api.createUser({
        email: newUserEmail.trim().toLowerCase(),
        name: newUserName.trim(),
      });
      setNewUserEmail('');
      setNewUserName('');
      setNotice(
        created.canSignIn
          ? `${created.email} added. They can sign in with Google now.`
          : `${created.email} added, but ${created.domain} is not an allowed domain yet — they cannot sign in until it is.`
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeUser = async (user: User) => {
    if (!window.confirm(`Remove ${user.email}? They will be re-added if they sign in again.`)) return;
    setError(null);
    setNotice(null);
    try {
      const result = await api.deleteUser(user.email);
      setNotice(
        result.releasedOrgs
          ? `${user.email} removed. The orgs they administered are unclaimed again.`
          : `${user.email} removed.`
      );
      await load();
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Administration</h1>
        {!isAdmin && orgAdminOf.length > 0 && (
          <p className="text-sm text-gray-500 mt-1">
            You administer {orgAdminOf.join(', ')}
            {scopedToDomains?.length ? ` — you manage users on ${scopedToDomains.join(', ')}.` : '.'}
          </p>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
      {notice && <div className="rounded-lg bg-green-50 text-green-800 px-4 py-3 text-sm">{notice}</div>}

      {isAdmin && (
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
              className={inputClass}
              placeholder="example.com"
              value={newDomain}
              onChange={e => setNewDomain(e.target.value)}
              required
            />
            <Button type="submit">Add domain</Button>
          </form>
        )}
      </section>
      )}

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-6 pb-4">
          <h2 className="font-semibold text-gray-900">Users</h2>
          <p className="text-sm text-gray-500 mt-1">
            {users.length} {users.length === 1 ? 'user' : 'users'}
            {scopedToDomains?.length ? ` on ${scopedToDomains.join(', ')}` : ''}.
          </p>

          <form onSubmit={addUser} className="flex flex-wrap gap-2 mt-4">
            <input
              className={inputClass}
              type="email"
              placeholder="person@example.com"
              value={newUserEmail}
              onChange={e => setNewUserEmail(e.target.value)}
              required
            />
            <input
              className={inputClass}
              placeholder="Name (optional)"
              value={newUserName}
              onChange={e => setNewUserName(e.target.value)}
            />
            <Button type="submit">Add user</Button>
          </form>
          <p className="text-xs text-gray-400 mt-2">
            Adding a user pre-registers the account; they still sign in with Google.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Email</th>
              <th className="px-6 py-3 font-medium">Role</th>
              <th className="px-6 py-3 font-medium">Last sign-in</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.email} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">{u.name}</td>
                <td className="px-6 py-3 text-gray-600">{u.email}</td>
                <td className="px-6 py-3 text-gray-600">{ROLE_LABELS[u.role]}</td>
                <td className="px-6 py-3 text-gray-500">
                  {u.lastLoginAt ? formatDate(u.lastLoginAt) : 'never'}
                </td>
                <td className="px-6 py-3 text-right whitespace-nowrap">
                  {isSuperAdmin && u.role !== 'super_admin' && u.email !== currentUser?.email && (
                    <Button
                      variant="ghost"
                      onClick={() => setRole(u.email, u.role === 'admin' ? 'user' : 'admin')}
                    >
                      {u.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                    </Button>
                  )}
                  {u.role !== 'super_admin' && u.email !== currentUser?.email && (
                    <Button variant="ghost" onClick={() => removeUser(u)}>Remove</Button>
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
