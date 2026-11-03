/**
 * Typed fetch client for the PharmaCore API. One place for: base URL, bearer token, refresh-on-401,
 * the error envelope `{ error: { code, message, messageEn, details }, requestId }`, and bigint-safe JSON.
 */
import { useAuth } from "./auth";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly messageEn: string, readonly details?: Record<string, unknown>, readonly requestId?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const API_BASE = (import.meta.env["VITE_API_BASE"] as string | undefined) ?? "/api/v1";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface Opts { method?: Method; body?: unknown; query?: Record<string, string | number | boolean | undefined>; signal?: AbortSignal; retry?: boolean }

function qs(q: Opts["query"]): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const { refreshToken, setTokens, logout } = useAuth.getState();
      if (!refreshToken) return false;
      const r = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken }) });
      if (!r.ok) { logout(); return false; }
      const j = (await r.json()) as { accessToken: string; refreshToken: string };
      setTokens(j.accessToken, j.refreshToken);
      return true;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const { accessToken, locale } = useAuth.getState();
  const headers: Record<string, string> = { accept: "application/json", "accept-language": locale };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (accessToken) headers["authorization"] = `Bearer ${accessToken}`;
  const init: RequestInit = { method: opts.method ?? "GET", headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  if (opts.signal) init.signal = opts.signal;
  const res = await fetch(`${API_BASE}${path}${qs(opts.query)}`, init);
  if (res.status === 401 && opts.retry !== false && accessToken && (await tryRefresh())) return api<T>(path, { ...opts, retry: false });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; messageEn?: string; details?: Record<string, unknown> }; requestId?: string } | null)?.error;
    throw new ApiError(res.status, e?.code ?? "http.error", e?.message ?? res.statusText, e?.messageEn ?? e?.message ?? res.statusText, e?.details, (json as { requestId?: string } | null)?.requestId);
  }
  return json as T;
}

export const get = <T>(path: string, query?: Opts["query"]) => api<T>(path, query ? { query } : {});
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

/** API money shape. */
export interface MoneyJson { currency: string; amountMinor: string }
