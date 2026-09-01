import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Role, User } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  isAllowed: boolean;
  user: User | null;
  role: Role;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

interface AuthContextType extends AuthState {
  login: () => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const initialState: AuthState = {
  isLoading: true,
  isAuthenticated: false,
  isAllowed: false,
  user: null,
  role: 'user',
  isAdmin: false,
  isSuperAdmin: false,
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
        isAdmin: data.isAdmin || false,
        isSuperAdmin: data.isSuperAdmin || false,
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

  const logout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, { credentials: 'include' });
      setState({ ...initialState, isLoading: false });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, checkAuth }}>
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
