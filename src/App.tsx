import { AuthProvider, useAuth } from './context/AuthContext';
import { navigate as navigateTo, usePathname } from './utils/navigate';
import type { View } from './types/view';
import { ALL_VIEWS } from './types/view';
import { Layout, Header } from './components/layout';
import { OrgsPage } from './components/orgs';
import { EventTypesPage, PreviewSlotsPage } from './components/eventTypes';
import { CommitmentTypesPage } from './components/commitments';
import { SettingsPage } from './components/settings';
import { BookingPage, ManageBookingPage } from './components/booking';
import { AdminPage } from './components/admin';
import { LoginPage, UnauthorizedPage, AuthCallback, RolePicker } from './components/auth';

function viewFromPath(pathname: string): View {
  const seg = pathname.replace(/^\/+/, '').split('/')[0];
  return (ALL_VIEWS as string[]).includes(seg) ? (seg as View) : 'event-types';
}

/** /book/<16-char slug> is the public booking page. */
function bookingSlug(pathname: string): string | null {
  const match = pathname.match(/^\/book\/([A-Za-z0-9]{16})\/?$/);
  return match ? match[1] : null;
}

/** /preview/<eventTypeId> is the full-page availability preview. */
function previewEventTypeId(pathname: string): string | null {
  const match = pathname.match(/^\/preview\/([A-Za-z0-9_-]+)\/?$/);
  return match ? match[1] : null;
}

/** /cancel/<token> and /reschedule/<token> come from the calendar invite. */
function manageBooking(pathname: string): { token: string; mode: 'cancel' | 'reschedule' } | null {
  const match = pathname.match(/^\/(cancel|reschedule)\/([A-Za-z0-9_-]{16,})\/?$/);
  return match ? { mode: match[1] as 'cancel' | 'reschedule', token: match[2] } : null;
}

// Event types is the landing page, so it owns "/".
function pathFromView(view: View): string {
  return view === 'event-types' ? '/' : `/${view}`;
}

function AppContent() {
  const { isLoading, isAuthenticated, isAllowed, isAdmin, canManageUsers, needsRoleChoice } = useAuth();

  // Every in-app navigation flows through the pathname, so back/forward work.
  const pathname = usePathname();
  const currentView = viewFromPath(pathname);
  const setCurrentView = (view: View) => navigateTo(pathFromView(view));

  // Public routes (no auth required)
  const slug = bookingSlug(pathname);
  if (slug) return <BookingPage slug={slug} />;
  const manage = manageBooking(pathname);
  if (manage) return <ManageBookingPage token={manage.token} mode={manage.mode} />;
  if (pathname === '/auth/callback') return <AuthCallback />;

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

  // The availability preview takes over everything but the header.
  const previewId = previewEventTypeId(pathname);
  if (previewId) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <main className="flex-1 p-6 w-full">
          <PreviewSlotsPage eventTypeId={previewId} />
        </main>
      </div>
    );
  }

  // Guard the admin view — platform admins and org admins may open it
  const canAdminister = isAdmin || canManageUsers;
  const effectiveView: View = currentView === 'admin' && !canAdminister ? 'event-types' : currentView;

  return (
    <Layout currentView={effectiveView} onViewChange={setCurrentView}>
      {effectiveView === 'orgs' && <OrgsPage />}
      {effectiveView === 'event-types' && <EventTypesPage />}
      {effectiveView === 'commitments' && <CommitmentTypesPage />}
      {effectiveView === 'settings' && <SettingsPage />}
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
