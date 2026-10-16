import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api, { refreshSession, setAccessToken, setAuthFailHandler } from '../api/client.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setAuthFailHandler(clear);
    refreshSession()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [clear]);

  const authenticate = (data) => {
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const login = async (body) => authenticate((await api.post('/auth/login', body)).data);
  const register = async (body) => authenticate((await api.post('/auth/register', body)).data);
  const logout = async () => {
    try { await api.post('/auth/logout'); } finally { clear(); }
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
