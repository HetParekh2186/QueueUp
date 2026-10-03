"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBanner, LiveDot, RequireAuth, Stat, StatusPill } from "@/components/ui";
import { PUBLIC_API_URL, api, errorMessage, loadAuth } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clock, money, toLocalInput } from "@/lib/format";
import type { Dashboard, EventDetail, Staff } from "@/lib/types";
import { useEventSocket } from "@/lib/useEventSocket";

export default function ManagePage() {
  return (
    <RequireAuth>
      <Manage />
    </RequireAuth>
  );
}

function Manage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const loadDash = useCallback(() => api<Dashboard>(`/events/${id}/dashboard`).then(setDash), [id]);
  const loadAll = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([api<EventDetail>(`/events/${id}`), api<Staff[]>(`/events/${id}/staff`)]);
      setEvent(e);
      setStaff(s);
      await loadDash();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id, loadDash]);
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Socket messages are hints: patch the obvious numbers instantly, then refetch the
  // authoritative dashboard (debounced, so a burst of scans costs one request).
  const live = useEventSocket(
    id,
    (msg) => {
      if (msg.type === "checkin") setDash((d) => d && { ...d, checked_in: msg.checked_in });
      if (msg.type === "hello") return;
      clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => loadDash().catch(() => {}), 400);
    },
    token,
  );

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      await loadAll();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function downloadCsv() {
    // The export needs the bearer token, so fetch it rather than linking to it.
    const res = await fetch(`${PUBLIC_API_URL}/events/${id}/attendees.csv`, {
      headers: { Authorization: `Bearer ${loadAuth()?.access_token}` },
    });
    if (!res.ok) return setError("Export failed. Try logging in again.");
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${event?.title ?? "event"}-attendees.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!event) return error ? <ErrorBanner message={error} /> : <p className="py-24 text-center text-muted">Loading…</p>;
  if (!event.can_manage) return <ErrorBanner message="You don't manage this event." />;
  const editable = event.status === "draft" || event.status === "published";

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <StatusPill status={event.status} />
            <LiveDot on={live} />
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight">{event.title}</h1>
          <Link href={`/events/${event.id}`} className="text-sm text-muted underline hover:text-ink">
            View public page
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {event.status === "draft" && (
            <button
              className="btn-primary"
              onClick={() => run(() => api(`/events/${id}`, { method: "PATCH", body: { status: "published" } }), "Published. Tickets are on sale.")}
            >
              Publish
            </button>
          )}
          {event.status !== "draft" && (
            <Link href={`/scan/${id}`} className="btn-primary">
              Door scanner
            </Link>
          )}
          <button className="btn-ghost" onClick={downloadCsv}>
            Export attendees
          </button>
          {editable && (
            <button
              className="btn-ghost !text-bad"
              onClick={() => {
                if (confirm("Cancel this event? Holds are released and paid orders refunded. This can't be undone."))
                  run(() => api(`/events/${id}`, { method: "PATCH", body: { status: "cancelled" } }), "Event cancelled.");
              }}
            >
              Cancel event
            </button>
          )}
          {event.status === "draft" && (
            <button
              className="btn-ghost !text-bad"
              onClick={() =>
                confirm("Delete this draft?") &&
                api(`/events/${id}`, { method: "DELETE" })
                  .then(() => router.push("/organizer"))
                  .catch((e) => setError(errorMessage(e)))
              }
            >
              Delete
            </button>
          )}
        </div>
      </header>

      <ErrorBanner message={error} />
      {notice && <div className="rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</div>}

      {dash && (
        <section>
          <h2 className="label">Live</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Checked in" value={dash.checked_in} tone="text-accent" />
            <Stat label="Paid, not in" value={dash.confirmed} />
            <Stat label="On hold" value={dash.held} tone={dash.held ? "text-warn" : ""} />
            <Stat label="Remaining" value={dash.remaining} />
            <Stat label="Revenue" value={money(dash.revenue_cents)} />
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-line" aria-hidden>
            {dash.capacity > 0 && (
              <div className="flex h-full">
                <div className="bg-accent transition-all" style={{ width: `${(dash.checked_in / dash.capacity) * 100}%` }} />
                <div className="bg-ink/70 transition-all" style={{ width: `${(dash.confirmed / dash.capacity) * 100}%` }} />
                <div className="bg-warn transition-all" style={{ width: `${(dash.held / dash.capacity) * 100}%` }} />
              </div>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-muted">
            {dash.checked_in + dash.confirmed + dash.held} of {dash.capacity} seats claimed
          </p>
        </section>
      )}

      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="label">Ticket types</h2>
          <div className="space-y-2">
            {event.ticket_types.map((t) => {
              const s = dash?.ticket_types.find((x) => x.id === t.id);
              return (
                <TierRow
                  key={t.id}
                  name={t.name}
                  price={t.price_cents}
                  capacity={t.capacity}
                  claimed={t.sold}
                  checkedIn={s?.checked_in ?? 0}
                  waiting={s?.waiting ?? 0}
                  editable={editable}
                  onCapacity={(capacity) =>
                    run(() => api(`/events/${id}/ticket-types/${t.id}`, { method: "PATCH", body: { capacity } }), "Capacity updated.")
                  }
                />
              );
            })}
          </div>
          {editable && <AddTier onAdd={(body) => run(() => api(`/events/${id}/ticket-types`, { method: "POST", body }), "Ticket type added.")} />}
        </section>

        <section>
          <h2 className="label">Door staff</h2>
          <p className="mb-3 text-sm text-muted">Staff can scan tickets and see live counts for this event only. They can&apos;t edit it.</p>
          <ul className="space-y-2">
            {staff.map((s) => (
              <li key={s.user_id} className="card flex items-center justify-between px-4 py-3">
                <span>
                  <span className="font-medium">{s.display_name}</span> <span className="text-sm text-muted">{s.email}</span>
                </span>
                <button
                  className="text-sm text-muted hover:text-bad"
                  onClick={() => run(() => api(`/events/${id}/staff/${s.user_id}`, { method: "DELETE" }))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const email = new FormData(form).get("email");
              run(() => api(`/events/${id}/staff`, { method: "POST", body: { email } }), "Staff assigned.").then(() => form.reset());
            }}
          >
            <input name="email" type="email" required placeholder="staff@example.com" className="input" aria-label="Staff email" />
            <button className="btn-ghost shrink-0">Assign</button>
          </form>
        </section>
      </div>

      {editable && <EditDetails event={event} onSave={(body) => run(() => api(`/events/${id}`, { method: "PATCH", body }), "Saved.")} />}

      {dash && dash.recent_scans.length > 0 && (
        <section>
          <h2 className="label">Recent scans</h2>
          <ul className="card divide-y divide-line">
            {dash.recent_scans.map((s, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-24 font-mono text-xs text-muted">{clock(s.scanned_at)}</span>
                <StatusPill status={s.result === "admitted" ? "checked_in" : s.result === "already_used" ? "held" : "cancelled"} />
                <span className="flex-1 truncate">
                  {s.attendee ?? "Unknown code"}
                  {s.reason && <span className="text-muted"> · {s.reason.replace("_", " ")}</span>}
                </span>
                <span className="text-xs text-muted">by {s.staff}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TierRow(props: {
  name: string;
  price: number;
  capacity: number;
  claimed: number;
  checkedIn: number;
  waiting: number;
  editable: boolean;
  onCapacity: (n: number) => void;
}) {
  const [cap, setCap] = useState(String(props.capacity));
  useEffect(() => setCap(String(props.capacity)), [props.capacity]);
  return (
    <div className="card flex flex-wrap items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{props.name}</div>
        <div className="text-sm text-muted">
          {money(props.price)} · <span className="font-mono">{props.claimed}</span> claimed ·{" "}
          <span className="font-mono">{props.checkedIn}</span> in
          {props.waiting > 0 && (
            <>
              {" · "}
              <span className="font-mono text-warn">{props.waiting}</span> waiting
            </>
          )}
        </div>
      </div>
      {props.editable ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            props.onCapacity(Number(cap));
          }}
        >
          <label className="text-xs text-muted" htmlFor={`cap-${props.name}`}>
            Capacity
          </label>
          <input
            id={`cap-${props.name}`}
            type="number"
            min={0}
            className="input !w-24 font-mono"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
          {Number(cap) !== props.capacity && <button className="btn-ghost !px-3 !py-2">Save</button>}
        </form>
      ) : (
        <span className="font-mono text-sm">cap {props.capacity}</span>
      )}
    </div>
  );
}

function AddTier({ onAdd }: { onAdd: (body: { name: string; price_cents: number; capacity: number }) => Promise<void> }) {
  return (
    <form
      className="mt-3 grid grid-cols-[1fr_6rem_6rem_auto] gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        onAdd({
          name: String(f.get("name")),
          price_cents: Math.round(Number(f.get("price")) * 100),
          capacity: Number(f.get("capacity")),
        }).then(() => form.reset());
      }}
    >
      <input name="name" required maxLength={60} placeholder="New tier, e.g. VIP" className="input" aria-label="Tier name" />
      <input name="price" type="number" min="0" step="0.01" required placeholder="$" className="input" aria-label="Price" />
      <input name="capacity" type="number" min="0" required placeholder="Seats" className="input" aria-label="Capacity" />
      <button className="btn-ghost">Add</button>
    </form>
  );
}

function EditDetails({ event, onSave }: { event: EventDetail; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  return (
    <section>
      <h2 className="label">Details</h2>
      <form
        className="card grid gap-4 p-5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSave({
            title: f.get("title"),
            venue: f.get("venue") || null,
            description: f.get("description") || null,
            starts_at_local: f.get("starts_at"),
          });
        }}
      >
        <div>
          <label className="label" htmlFor="ed-title">
            Title
          </label>
          <input id="ed-title" name="title" className="input" defaultValue={event.title} required maxLength={200} />
        </div>
        <div>
          <label className="label" htmlFor="ed-venue">
            Venue
          </label>
          <input id="ed-venue" name="venue" className="input" defaultValue={event.venue ?? ""} maxLength={300} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ed-desc">
            Description
          </label>
          <textarea id="ed-desc" name="description" className="input min-h-24" defaultValue={event.description ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="ed-start">
            Starts ({event.timezone})
          </label>
          <input
            id="ed-start"
            name="starts_at"
            type="datetime-local"
            className="input"
            defaultValue={toLocalInput(event.starts_at, event.timezone)}
            required
          />
        </div>
        <div className="flex items-end">
          <button className="btn-ghost">Save details</button>
        </div>
      </form>
    </section>
  );
}
