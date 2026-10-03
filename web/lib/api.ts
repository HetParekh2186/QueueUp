import type { TokenResponse } from "./types";

export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Server components run inside the compose network, where the API has another name. */
export const SERVER_API_URL = process.env.API_INTERNAL_URL ?? PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: Record<string, unknown>,
  ) {
    super(code);
  }
}

const STORAGE_KEY = "queueup.auth";

export type StoredAuth = TokenResponse;

export function loadAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

export function saveAuth(auth: StoredAuth | null) {
  try {
    if (auth) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: stay logged in for this tab only */
  }
  window.dispatchEvent(new Event("queueup-auth"));
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const auth = loadAuth();
  if (!auth) return false;
  const res = await fetch(`${PUBLIC_API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: auth.refresh_token }),
  });
  if (!res.ok) {
    saveAuth(null);
    return false;
  }
  saveAuth((await res.json()) as TokenResponse);
  return true;
}

type Options = { method?: string; body?: unknown; auth?: boolean };

/** Browser-side API call. Attaches the access token and transparently refreshes it once. */
export async function api<T>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const auth = loadAuth();
  if (auth && opts.auth !== false) headers["Authorization"] = `Bearer ${auth.access_token}`;

  const res = await fetch(`${PUBLIC_API_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && auth && !retried) {
    refreshing ??= refreshTokens().finally(() => (refreshing = null));
    if (await refreshing) return api<T>(path, opts, true);
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? data.result ?? "error", data);
  }
  return data as T;
}

/** Server-component fetch: no auth, never cached (seat counts change constantly). */
export async function serverApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function wsUrl(path: string): string {
  return PUBLIC_API_URL.replace(/^http/, "ws") + path;
}

const MESSAGES: Record<string, string> = {
  sold_out: "Sold out — someone got there first.",
  duplicate_request: "That reservation was already submitted.",
  event_not_on_sale: "This event isn't on sale.",
  per_user_limit: "You've reached the ticket limit for this tier.",
  hold_expired: "Your hold expired and the seats went back on sale. Please reserve again.",
  payment_declined: "Payment was declined. Try another card.",
  invalid_credentials: "Email or password is incorrect.",
  email_taken: "An account with that email already exists.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  capacity_below_sold: "Capacity can't go below tickets already claimed.",
  already_checked_in: "A ticket on this order was already used at the door.",
  no_ticket_types: "Add at least one ticket type before publishing.",
  event_in_past: "The start time is in the past.",
  event_has_orders: "This event has orders. Cancel it instead of deleting.",
  user_not_found: "No QueueUp account with that email.",
  validation_error: "Please check the highlighted fields.",
  forbidden: "You don't have access to that.",
  not_assigned: "You're not assigned to scan this event.",
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? `Something went wrong (${err.code}).`;
  return "Can't reach QueueUp right now. Check your connection.";
}
