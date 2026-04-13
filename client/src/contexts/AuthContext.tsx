/**
 * Auth context: manages JWT token, user info, and login/logout.
 * Token is persisted in localStorage.
 *
 * Also exposes `requireLogin(reason)` — shows a modal sign-in dialog
 * when an action requires auth; resolves when the user is signed in,
 * rejects when they cancel.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import LoginModal from '../components/LoginModal';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string | null;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  /** Ensure the user is signed in. If already signed in, resolves immediately.
   *  Otherwise pops a login modal; resolves on success, rejects on cancel. */
  requireLogin: (reason?: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = 'sf:auth:token';
const USER_KEY = 'sf:auth:user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem(USER_KEY);
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(false);

  // Login-modal state and the pending-promise callbacks for requireLogin().
  const [modalReason, setModalReason] = useState<string | null>(null);
  const pendingRef = useRef<{ resolve: () => void; reject: (err: Error) => void } | null>(null);

  // Validate token on mount
  useEffect(() => {
    if (token && !user) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => res.ok ? res.json() : Promise.reject())
        .then((u: AuthUser) => {
          setUser(u);
          localStorage.setItem(USER_KEY, JSON.stringify(u));
        })
        .catch(() => {
          // Token expired/invalid
          setToken(null);
          setUser(null);
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        });
    }
  }, [token, user]);

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Login failed' }));
        throw new Error(err.detail || 'Login failed');
      }
      const data = await res.json();
      setToken(data.access_token);
      setUser(data.user);
      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (username: string, password: string, displayName?: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, display_name: displayName || username }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Registration failed' }));
        throw new Error(err.detail || 'Registration failed');
      }
      const data = await res.json();
      setToken(data.access_token);
      setUser(data.user);
      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  const requireLogin = useCallback((reason?: string): Promise<void> => {
    if (user) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      pendingRef.current = { resolve, reject };
      setModalReason(reason ?? '');
    });
  }, [user]);

  const handleModalSuccess = useCallback(() => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setModalReason(null);
    p?.resolve();
  }, []);

  const handleModalCancel = useCallback(() => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setModalReason(null);
    p?.reject(new Error('Login cancelled'));
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, requireLogin }}>
      {children}
      {modalReason !== null && (
        <LoginModal
          reason={modalReason || 'This action requires you to be signed in.'}
          onSuccess={handleModalSuccess}
          onCancel={handleModalCancel}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Get the stored auth token for use in API calls.
 */
export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
