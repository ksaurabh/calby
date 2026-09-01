import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { Role } from '../../types';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../utils/roles';

interface RolePickerProps {
  /** Shown when switching mid-session rather than choosing at sign-in. */
  onCancel?: () => void;
}

export function RolePicker({ onCancel }: RolePickerProps) {
  const { user, role, availableRoles, chooseRole, logout } = useAuth();
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (choice: Role) => {
    setBusy(choice);
    setError(null);
    try {
      await chooseRole(choice);
      onCancel?.();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">Continue as…</h1>
          <p className="mt-2 text-sm text-gray-600">
            {user?.email} can act in more than one capacity. Pick one for this session.
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm mb-4">{error}</div>
        )}

        <div className="space-y-3">
          {availableRoles.map(option => (
            <button
              key={option}
              onClick={() => pick(option)}
              disabled={busy !== null}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-colors disabled:opacity-60 ${
                option === role && onCancel
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-blue-500 hover:bg-blue-50'
              }`}
            >
              <div className="font-medium text-gray-900">
                {ROLE_LABELS[option]}
                {option === role && onCancel && (
                  <span className="ml-2 text-xs font-normal text-blue-600">current</span>
                )}
              </div>
              <div className="text-sm text-gray-500 mt-0.5">{ROLE_DESCRIPTIONS[option]}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 text-center">
          {onCancel ? (
            <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-800">
              Cancel
            </button>
          ) : (
            <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-800">
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
