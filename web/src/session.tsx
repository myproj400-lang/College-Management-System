import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  student?: { id: string; studentNumber: string; programme?: { name: string } } | null;
  staff?: { id: string; staffNumber: string } | null;
};

type SessionValue = {
  token: string | null;
  user: SessionUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);
const TOKEN_KEY = 'cms.token';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    api(token)
      .get<SessionUser>('/auth/me')
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        sessionStorage.removeItem(TOKEN_KEY);
        if (!cancelled) {
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const value = useMemo<SessionValue>(
    () => ({
      token,
      user,
      ready,
      async login(email, password) {
        const result = await api().post<{ token: string }>('/auth/login', { email, password });
        sessionStorage.setItem(TOKEN_KEY, result.token);
        setReady(false);
        setToken(result.token);
      },
      logout() {
        sessionStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      },
    }),
    [token, user, ready],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Session missing');
  return value;
}
