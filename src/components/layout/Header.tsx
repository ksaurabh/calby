import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { RolePicker } from '../auth';
import { ROLE_LABELS } from '../../utils/roles';

export function Header() {
  const { user, role, availableRoles, logout } = useAuth();
  const [switching, setSwitching] = useState(false);

  const roleLabel = ROLE_LABELS[role];
  const canSwitch = availableRoles.length > 1;

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 sticky top-0 z-30">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white font-bold">C</span>
        <span className="font-semibold text-gray-900">Calby</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <div className="text-sm font-medium text-gray-900">{user?.name}</div>
          {canSwitch ? (
            <button
              onClick={() => setSwitching(true)}
              className="text-xs text-blue-600 hover:text-blue-800"
              title="Switch role"
            >
              {roleLabel} · switch
            </button>
          ) : (
            <div className="text-xs text-gray-500">{roleLabel}</div>
          )}
        </div>
        {user?.picture ? (
          <img src={user.picture} alt={user.name} className="w-9 h-9 rounded-full" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-700">
            {user?.name?.[0]?.toUpperCase()}
          </div>
        )}
        <button
          onClick={logout}
          className="text-sm text-gray-500 hover:text-gray-800 px-2 py-1"
        >
          Sign out
        </button>
      </div>

      {switching && (
        <div className="fixed inset-0 z-50">
          <RolePicker onCancel={() => setSwitching(false)} />
        </div>
      )}
    </header>
  );
}
