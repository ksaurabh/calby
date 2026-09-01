import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useOrgStore } from '../../store/orgStore';
import type { Org } from '../../types';
import { formatDate } from '../../utils/format';
import { Button, Modal } from '../common';
import { OrgForm } from './OrgForm';

export function OrgsPage() {
  const { user, isAdmin } = useAuth();
  const { orgs, isLoading, error, fetchOrgs, createOrg, updateOrg, deleteOrg } = useOrgStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Org | null>(null);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  const canModify = (org: Org) => isAdmin || org.createdBy === user?.email;

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleSubmit = async (values: { name: string; domain: string }) => {
    if (editing) {
      await updateOrg(editing.id, values);
    } else {
      await createOrg(values);
    }
    closeForm();
  };

  const handleDelete = async (org: Org) => {
    if (!window.confirm(`Delete "${org.name}"? This cannot be undone.`)) return;
    await deleteOrg(org.id);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organizations</h1>
          <p className="text-sm text-gray-500 mt-1">{orgs.length} total</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}>+ New organization</Button>
      </div>

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm mb-4">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading…</div>
        ) : orgs.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">▦</div>
            <h2 className="font-medium text-gray-900">No organizations yet</h2>
            <p className="text-sm text-gray-500 mt-1">Create the first one to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Domain</th>
                <th className="px-6 py-3 font-medium">Created by</th>
                <th className="px-6 py-3 font-medium">Created</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orgs.map(org => (
                <tr key={org.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <div className="font-medium text-gray-900">{org.name}</div>
                    <div className="text-xs text-gray-400">{org.slug}</div>
                  </td>
                  <td className="px-6 py-3 text-gray-600">{org.domain || '—'}</td>
                  <td className="px-6 py-3 text-gray-600">{org.createdBy}</td>
                  <td className="px-6 py-3 text-gray-600">{formatDate(org.createdAt)}</td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    {canModify(org) && (
                      <>
                        <Button
                          variant="ghost"
                          onClick={() => { setEditing(org); setShowForm(true); }}
                        >
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => handleDelete(org)}>Delete</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        isOpen={showForm}
        onClose={closeForm}
        title={editing ? 'Edit organization' : 'New organization'}
      >
        <OrgForm org={editing || undefined} onSubmit={handleSubmit} onCancel={closeForm} />
      </Modal>
    </div>
  );
}
