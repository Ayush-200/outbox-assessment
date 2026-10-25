import { Session } from './types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const apiOrigin = API_URL;

export const readSession = (): Session | null => {
  const raw = localStorage.getItem('session');
  return raw ? (JSON.parse(raw) as Session) : null;
};

export const writeSession = (session: Session) =>
  localStorage.setItem('session', JSON.stringify(session));

export const clearSession = () => localStorage.removeItem('session');

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Something went wrong';

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = readSession();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    clearSession();
    window.location.reload();
    throw new Error('Session expired, please sign in again');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}
