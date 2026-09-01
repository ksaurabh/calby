import { useAuth } from '../../context/AuthContext';
import { Button } from '../common';

export function UnauthorizedPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
        <div className="text-4xl mb-4">🔒</div>
        <h1 className="text-xl font-bold text-gray-900">Access not authorized</h1>
        <p className="mt-3 text-gray-600">
          {user?.email ? <span className="font-medium">{user.email}</span> : 'Your account'} is not
          from an approved domain. Contact your administrator to request access.
        </p>
        <div className="mt-6">
          <Button variant="secondary" onClick={logout}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
