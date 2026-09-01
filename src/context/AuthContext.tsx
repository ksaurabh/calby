import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Role, User } from '../types';
import { api } from '../utils/api';

const API_URL = import.meta.env.VITE_API_URL || '';

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  isAllowed: boolean;
  user: User | null;
  /** The role currently in force — what the user chose to act as. */
  role: Role;
  /** The role the account actually holds, regardless of the current choice. */
  actualRole: Role;
  /** Roles this account may act as; more than one means the picker applies. */
  availableRoles: Role[];
  /** True until a privileged user has picked a role for this session. */
  needsRoleChoice: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** True for platform admins and for org admins (who manage their own domain). */
  canManageUsers: boolean;
  /** Names of the orgs this user is the claimed admin of. */
  orgAdminOf: string[];
  /** Where this user's AI features get their API key. */
  aiKeySource: 'org' | 'server' | null;
}

interface AuthContextType extends AuthState {
  login: () => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  chooseRole: (role: Role) => Promise<void>;
}

const initialState: AuthState = {
  isLoading: true,
  isAuthenticated: false,
  isAllowed: false,
  user: null,
  role: 'user',
  actualRole: 'user',
  availableRoles: ['user'],
  needsRoleChoice: false,
  isAdmin: false,
  isSuperAdmin: false,
  canManageUsers: false,
  orgAdminOf: [],
  aiKeySource: null,
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/auth/user`, { credentials: 'include' });
      const data = await response.json();
      setState({
        isLoading: false,
        isAuthenticated: data.authenticated,
        isAllowed: data.allowed || false,
        user: data.user || null,
        role: data.role || 'user',
        actualRole: data.actualRole || data.role || 'user',
        availableRoles: data.availableRoles || ['user'],
        needsRoleChoice: data.needsRoleChoice || false,
        isAdmin: data.isAdmin || false,
        isSuperAdmin: data.isSuperAdmin || false,
        canManageUsers: data.canManageUsers || false,
        orgAdminOf: data.orgAdminOf || [],
        aiKeySource: data.aiKeySource || null,
      });
    } catch (error) {
      console.error('Auth check failed:', error);
      setState({ ...initialState, isLoading: false });
    }
  }, []);

  useEffect(() => {
    // Initial auth check; state is updated asynchronously after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkAuth();
  }, [checkAuth]);

  const login = () => {
    window.location.href = `${API_URL}/auth/google`;
  };

  // Pick the role to act as. The server stores it on the session and enforces
  // it, so re-reading auth state afterwards keeps the client in step.
  const chooseRole = async (role: Role) => {
    await api.setActiveRole(role);
    await checkAuth();
  };

  const logout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, { credentials: 'include' });
      setState({ ...initialState, isLoading: false });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, checkAuth, chooseRole }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
