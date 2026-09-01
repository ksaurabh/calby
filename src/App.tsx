import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import type { View } from './types/view';
import { ALL_VIEWS } from './types/view';
import { Layout } from './components/layout';
import { OrgsPage } from './components/orgs';
import { EventTypesPage } from './components/eventTypes';
import { BookingPage } from './components/booking';
import { AdminPage } from './components/admin';
import { LoginPage, UnauthorizedPage, AuthCallback, RolePicker } from './components/auth';

function viewFromPath(pathname: string): View {
  const seg = pathname.replace(/^\/+/, '').split('/')[0];
  return (ALL_VIEWS as string[]).includes(seg) ? (seg as View) : 'orgs';
}

/** /book/<16-char slug> is the public booking page. */
function bookingSlug(pathname: string): string | null {
  const match = pathname.match(/^\/book\/([A-Za-z0-9]{16})\/?$/);
  return match ? match[1] : null;
}

function pathFromView(view: View): string {
  return view === 'orgs' ? '/' : `/${view}`;
}

function AppContent() {
  const { isLoading, isAuthenticated, isAllowed, isAdmin, canManageUsers, needsRoleChoice } = useAuth();

  const [currentView, setCurrentViewState] = useState<View>(() => viewFromPath(window.location.pathname));

  const setCurrentView = (view: View) => {
    setCurrentViewState(view);
    const path = pathFromView(view);
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
  };

  useEffect(() => {
    const handlePopState = () => setCurrentViewState(viewFromPath(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Public routes (no auth required)
  const slug = bookingSlug(window.location.pathname);
  if (slug) return <BookingPage slug={slug} />;
  if (window.location.pathname === '/auth/callback') return <AuthCallback />;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;
  if (!isAllowed) return <UnauthorizedPage />;
  // Privileged accounts choose which role to act as before entering the app.
  if (needsRoleChoice) return <RolePicker />;

  // Guard the admin view — platform admins and org admins may open it
  const canAdminister = isAdmin || canManageUsers;
  const effectiveView: View = currentView === 'admin' && !canAdminister ? 'orgs' : currentView;

  return (
    <Layout currentView={effectiveView} onViewChange={setCurrentView}>
      {effectiveView === 'orgs' && <OrgsPage />}
      {effectiveView === 'event-types' && <EventTypesPage />}
      {effectiveView === 'admin' && <AdminPage />}
    </Layout>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
