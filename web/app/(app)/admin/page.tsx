"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SearchBox, Segmented } from "@/components/Filters";
import { ErrorBanner, RequireAuth, Stat, StatusPill } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { eventTime, money } from "@/lib/format";
import type { AdminStats, AdminUser, EventSummary } from "@/lib/types";

type Tab = "overview" | "users" | "events";

export default function AdminPage() {
  return (
    <RequireAuth>
      <AdminGate />
    </RequireAuth>
  );
}

function AdminGate() {
  const { user } = useAuth();
  // The API enforces this on every route; hiding the page is only a courtesy.
  if (user?.role !== "admin") return <p className="py-24 text-center text-muted">This page is for the site admin.</p>;
  return <Admin />;
}

function Admin() {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(() => {
    api<AdminStats>("/admin/stats").then(setStats).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(loadStats, [loadStats]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Admin</h1>
          <p className="text-muted">Everything on QueueUp: people, roles and every event.</p>
        </div>
        <Segmented
          label="Section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "Overview" },
            { value: "users", label: "Users" },
            { value: "events", label: "Events" },
          ]}
        />
      </div>
      <div className="mt-4">
        <ErrorBanner message={error} />
      </div>

      {tab === "overview" && (
        <Overview stats={stats} onChange={loadStats} onShowRequests={() => setTab("users")} />
      )}
      {tab === "users" && <Users onChange={loadStats} />}
      {tab === "events" && <Events />}
    </div>
  );
}

/* ---------------------------------------------------------------- overview */

function Overview({ stats, onChange, onShowRequests }: { stats: AdminStats | null; onChange: () => void; onShowRequests: () => void }) {
  return (
    <div className="mt-8 space-y-10">
      {stats && (
        <section>
          <h2 className="label">Platform</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Accounts" value={stats.users} />
            <Stat label="Organizers" value={stats.organizers} />
            <Stat label="Tickets sold" value={stats.tickets_sold} />
            <Stat label="Revenue" value={money(stats.revenue_cents)} />
            <Stat label="On sale" value={stats.events_by_status.published} />
            <Stat label="Drafts" value={stats.events_by_status.draft} />
            <Stat label="Checked in" value={stats.checked_in} />
            <Stat label="Suspended" value={stats.suspended} tone={stats.suspended ? "text-bad" : ""} />
          </div>
        </section>
      )}
      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 className="label !mb-0">Organizer requests{stats ? ` (${stats.pending_requests})` : ""}</h2>
          <button className="text-sm text-muted underline underline-offset-4 hover:text-ink" onClick={onShowRequests}>
            All users
          </button>
        </div>
        <UserList query={{ requested: "true" }} onChange={onChange} empty="No one is waiting for organizer access." />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- users */

type RoleFilter = "all" | "user" | "organizer" | "admin" | "requested" | "suspended";

function Users({ onChange }: { onChange: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<RoleFilter>("all");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query: Record<string, string> = {};
  if (debounced) query.q = debounced;
  if (filter === "requested") query.requested = "true";
  else if (filter === "suspended") query.suspended = "true";
  else if (filter !== "all") query.role = filter;

  return (
    <div className="mt-8">
      <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-line pb-6">
        <SearchBox value={q} onChange={setQ} placeholder="Search name or email" label="Search users" />
        <Segmented
          label="Filter users"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "user", label: "Users" },
            { value: "organizer", label: "Organizers" },
            { value: "admin", label: "Admin" },
            { value: "requested", label: "Requests" },
            { value: "suspended", label: "Suspended" },
          ]}
        />
      </div>
      <UserList query={query} onChange={onChange} empty="No accounts match." />
    </div>
  );
}

function UserList({ query, onChange, empty }: { query: Record<string, string>; onChange: () => void; empty: string }) {
  const [items, setItems] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const key = new URLSearchParams(query).toString();

  const load = useCallback(
    async (offset = 0) => {
      try {
        const page = await api<{ items: AdminUser[]; total: number }>(`/admin/users?${key}&limit=50&offset=${offset}`);
        setItems((prev) => (offset === 0 ? page.items : [...(prev ?? []), ...page.items]));
        setTotal(page.total);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [key],
  );
  useEffect(() => {
    load(0);
  }, [load]);

  async function patch(u: AdminUser, body: Record<string, unknown>) {
    setBusyId(u.id);
    setError(null);
    try {
      const updated = await api<AdminUser>(`/admin/users/${u.id}`, { method: "PATCH", body });
      // Leave the row in place with its new state; it drops out of a filtered view on the next load.
      setItems((prev) => prev?.map((x) => (x.id === u.id ? updated : x)) ?? null);
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  if (items === null) return error ? <ErrorBanner message={error} /> : <p className="text-muted">Loading…</p>;
  if (items.length === 0) return <p className="card p-6 text-muted">{empty}</p>;

  return (
    <div>
      <ErrorBanner message={error} />
      <ul className="card divide-y divide-line">
        {items.map((u) => {
          const busy = busyId === u.id;
          const waiting = u.role === "user" && u.organizer_requested_at;
          return (
            <li key={u.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-60">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{u.display_name}</span>
                  <RoleBadge role={u.role} />
                  {u.is_suspended && <StatusPill status="suspended" />}
                  {waiting && <StatusPill status="pending" />}
                </div>
                <div className="truncate text-sm text-muted">{u.email}</div>
                <div className="text-xs text-muted">
                  {u.events_organized} events · {u.tickets_held} tickets · joined{" "}
                  {new Date(u.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {waiting &&
                    ` · requested organizer ${new Date(u.organizer_requested_at!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                </div>
              </div>
              {u.role === "admin" ? (
                <span className="text-xs text-muted">Set by ADMIN_EMAILS on the server</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {waiting && (
                    <>
                      <button className="btn-primary !px-3 !py-1.5" disabled={busy} onClick={() => patch(u, { role: "organizer" })}>
                        Approve
                      </button>
                      <button className="btn-ghost !px-3 !py-1.5" disabled={busy} onClick={() => patch(u, { decline_request: true })}>
                        Decline
                      </button>
                    </>
                  )}
                  {!waiting && u.role === "user" && (
                    <button className="btn-ghost !px-3 !py-1.5" disabled={busy} onClick={() => patch(u, { role: "organizer" })}>
                      Make organizer
                    </button>
                  )}
                  {u.role === "organizer" && (
                    <button
                      className="btn-ghost !px-3 !py-1.5"
                      disabled={busy}
                      onClick={() =>
                        confirm(`Remove organizer access from ${u.display_name}? They keep the events they already own.`) &&
                        patch(u, { role: "user" })
                      }
                    >
                      Remove organizer
                    </button>
                  )}
                  <button
                    className={`btn-ghost !px-3 !py-1.5 ${u.is_suspended ? "" : "!text-bad"}`}
                    disabled={busy}
                    onClick={() =>
                      u.is_suspended
                        ? patch(u, { suspended: false })
                        : confirm(`Suspend ${u.display_name}? They're logged out and can't sign in until restored.`) &&
                          patch(u, { suspended: true })
                    }
                  >
                    {u.is_suspended ? "Restore" : "Suspend"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {items.length < total && (
        <div className="mt-4 text-center">
          <button className="btn-ghost" onClick={() => load(items.length)}>
            More ({total - items.length} left)
          </button>
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const tone =
    role === "admin" ? "bg-accent text-accent-ink" : role === "organizer" ? "border border-ink text-ink" : "border border-line text-muted";
  return (
    <span className={`rounded-[2px] px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] ${tone}`}>
      {role}
    </span>
  );
}

/* ------------------------------------------------------------------ events */

type StatusFilter = "all" | "published" | "draft" | "ended" | "cancelled";

function Events() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [items, setItems] = useState<EventSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const key = new URLSearchParams({ ...(debounced ? { q: debounced } : {}), ...(status !== "all" ? { status } : {}) }).toString();
  const load = useCallback(
    async (offset = 0) => {
      try {
        const page = await api<{ items: EventSummary[]; total: number }>(`/admin/events?${key}&limit=50&offset=${offset}`);
        setItems((prev) => (offset === 0 ? page.items : [...(prev ?? []), ...page.items]));
        setTotal(page.total);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [key],
  );
  useEffect(() => {
    load(0);
  }, [load]);

  return (
    <div className="mt-8">
      <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-line pb-6">
        <SearchBox value={q} onChange={setQ} placeholder="Search events or venues" label="Search events" />
        <Segmented
          label="Event status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All" },
            { value: "published", label: "On sale" },
            { value: "draft", label: "Drafts" },
            { value: "ended", label: "Ended" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </div>
      <ErrorBanner message={error} />
      {items === null ? (
        <p className="text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="card p-6 text-muted">No events match.</p>
      ) : (
        <>
          <ul className="card divide-y divide-line">
            {items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-60">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{e.title}</span>
                    <StatusPill status={e.status} />
                    {e.is_demo && (
                      <span className="rounded-[2px] border border-line px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                        Demo
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted">
                    {eventTime(e.starts_at, e.timezone)}
                    {e.venue ? ` · ${e.venue}` : ""}
                  </div>
                </div>
                <span className="font-mono text-sm tabular text-muted">
                  {e.capacity - e.remaining}/{e.capacity} claimed
                </span>
                <div className="flex gap-2">
                  {e.status !== "draft" && (
                    <Link href={`/events/${e.id}`} className="btn-ghost !px-3 !py-1.5">
                      View
                    </Link>
                  )}
                  <Link href={`/organizer/events/${e.id}`} className="btn-ghost !px-3 !py-1.5">
                    Manage
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {items.length < total && (
            <div className="mt-4 text-center">
              <button className="btn-ghost" onClick={() => load(items.length)}>
                More ({total - items.length} left)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
