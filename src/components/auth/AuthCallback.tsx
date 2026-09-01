import { useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

export function AuthCallback() {
  const { checkAuth } = useAuth();

  useEffect(() => {
    checkAuth().then(() => {
      window.history.replaceState({}, '', '/');
      window.location.reload();
    });
  }, [checkAuth]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Completing sign in...</p>
      </div>
    </div>
  );
}
