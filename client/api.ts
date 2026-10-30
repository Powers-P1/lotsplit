import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult, AppView } from '../shared/types';

export class RequestError extends Error {
  constructor(message: string, public code: string, public fields?: Record<string, string>) {
    super(message);
    this.name = 'RequestError';
  }
}

const connectionMessage = 'Connection to the app was lost. Checking again…';

export async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, signal, credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new RequestError('We could not confirm the outcome. Check the current status before trying again.', 'NETWORK_ERROR');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(data.error || 'We could not complete this action. Please try again.', data.code || 'REQUEST_FAILED', data.fields);
  return data as T;
}

export function useApplication() {
  const [state, setState] = useState<AppView>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const inFlight = useRef(false);
  const busyRef = useRef(false);
  const mutationEpoch = useRef(0);
  const refresh = useCallback(async () => {
    if (inFlight.current || busyRef.current) return;
    inFlight.current = true;
    const epoch = mutationEpoch.current;
    try {
      const view = await request<AppView>('/state');
      if (epoch === mutationEpoch.current) {
        setState(view);
        setError(current => current === connectionMessage ? undefined : current);
      }
    }
    catch (cause) {
      if (epoch !== mutationEpoch.current) return;
      const message = cause instanceof RequestError && cause.code === 'NETWORK_ERROR' ? connectionMessage : cause instanceof Error ? cause.message : 'We could not connect to the app.';
      // A failed background refresh must not overwrite a meaningful action/payment result.
      setError(current => current && current !== connectionMessage ? current : message);
    }
    finally { inFlight.current = false; setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 3500);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const mutate = useCallback(async (path: string, body?: unknown, method = 'POST'): Promise<ApiResult | undefined> => {
    if (busyRef.current) return;
    busyRef.current = true;
    mutationEpoch.current += 1;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const result = await request<ApiResult>(path, method, body);
      if (result.state) setState(result.state);
      if (result.message) setNotice(result.message);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not save your changes.');
      if (cause instanceof RequestError && ['STALE_REVISION', 'CONFLICT', 'STALE_PLAN'].includes(cause.code)) {
        try { setState(await request<AppView>('/state')); } catch { /* retain the current readable state */ }
      }
      return undefined;
    } finally { busyRef.current = false; setBusy(false); }
  }, []);
  return { state, loading, busy, error, notice, setError, setNotice, refresh, mutate };
}
export type Mutate = ReturnType<typeof useApplication>['mutate'];

export function useRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const change = () => { setRoute(window.location.hash.slice(1) || '/'); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const navigate = useCallback((next: string) => {
    if (window.location.hash === `#${next}`) window.scrollTo({ top: 0 });
    else window.location.hash = next;
  }, []);
  return { route, navigate };
}
