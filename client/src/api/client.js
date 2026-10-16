import axios from 'axios';

let accessToken = null;
let onAuthFail = null;

export const setAccessToken = (t) => { accessToken = t; };
export const setAuthFailHandler = (fn) => { onAuthFail = fn; };

// In development the Vite proxy serves /api. In production set VITE_API_URL to the API origin.
const API = `${import.meta.env.VITE_API_URL || ''}/api`;
const api = axios.create({ baseURL: API, withCredentials: true });

api.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

// One refresh at a time, even if several requests fail together.
let refreshing = null;
export function refreshSession() {
  if (!refreshing) {
    refreshing = axios
      .post(`${API}/auth/refresh`, null, { withCredentials: true })
      .then((r) => {
        setAccessToken(r.data.accessToken);
        return r.data;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config;
    const isAuthRoute = original?.url?.includes('/auth/');
    if (err.response?.status === 401 && original && !original._retry && !isAuthRoute) {
      original._retry = true;
      try {
        await refreshSession();
        return api(original);
      } catch {
        setAccessToken(null);
        onAuthFail?.();
      }
    }
    return Promise.reject(err);
  }
);

export const errorMessage = (err) => err?.response?.data?.error?.message || 'Something went wrong. Try again.';
export const fieldErrors = (err) =>
  Object.fromEntries((err?.response?.data?.error?.details || []).map((d) => [d.field, d.message]));

export default api;

// Downloads a protected file (PDF/CSV) using the current session.
export async function downloadFile(path, fallbackName = 'download') {
  const res = await api.get(path, { responseType: 'blob' });
  const cd = res.headers['content-disposition'] || '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
