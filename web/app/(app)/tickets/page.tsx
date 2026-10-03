"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SearchBox, Segmented } from "@/components/Filters";
import { CheckIcon } from "@/components/icons";
import { ErrorBanner, QrImage, RequireAuth, StatusPill } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { eventTime, money } from "@/lib/format";
import type { EventSummary, Order, Ticket } from "@/lib/types";

export default function TicketsPage() {
  return (
    <RequireAuth>
      <Tickets />
    </RequireAuth>
  );
}

type Tab = "upcoming" | "past" | "cancelled";

// An event still counts as upcoming until a few hours after it starts (people arrive late).
const GRACE_MS = 6 * 60 * 60 * 1000;

function group(tickets: Ticket[]): Record<Tab, Ticket[]> {
  const now = Date.now();
  const out: Record<Tab, Ticket[]> = { upcoming: [], past: [], cancelled: [] };
  for (const t of tickets) {
    if (t.status === "cancelled" || t.event_status === "cancelled") out.cancelled.push(t);
    else if (new Date(t.starts_at).getTime() + GRACE_MS >= now) out.upcoming.push(t);
    else out.past.push(t);
  }
  const at = (t: Ticket) => new Date(t.starts_at).getTime();
  out.upcoming.sort((a, b) => at(a) - at(b));
  out.past.sort((a, b) => at(b) - at(a)); // most recent first
  out.cancelled.sort((a, b) => at(b) - at(a));
  return out;
}

function Tickets() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [holds, setHolds] = useState<Order[]>([]);
  const [shifts, setShifts] = useState<EventSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [scan, setScan] = useState<"all" | "unused" | "used">("all");
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    Promise.all([api<Ticket[]>("/me/tickets"), api<Order[]>("/me/holds"), api<EventSummary[]>("/me/staff-events")])
      .then(([t, h, s]) => {
        setTickets(t);
        setHolds(h);
        // Door shifts: events you're assigned to scan that haven't finished.
        setShifts(s.filter((e) => e.status === "published"));
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  async function refund(orderId: string) {
    if (!confirm("Refund this order? All tickets on it will be cancelled and the seats released.")) return;
    try {
      await api(`/orders/${orderId}/refund`, { method: "POST" });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const groups = useMemo(() => group(tickets ?? []), [tickets]);
  // Open on the first tab that has something in it (once, when tickets first arrive).
  const [tabChosen, setTabChosen] = useState(false);
  useEffect(() => {
    if (tickets && !tabChosen) {
      setTab(groups.upcoming.length ? "upcoming" : groups.past.length ? "past" : groups.cancelled.length ? "cancelled" : "upcoming");
      setTabChosen(true);
    }
  }, [tickets, tabChosen, groups]);
  const needle = q.trim().toLowerCase();
  const shown = groups[tab].filter(
    (t) =>
      (scan === "all" || (scan === "used" ? t.status === "checked_in" : t.status === "confirmed")) &&
      (!needle || t.event_title.toLowerCase().includes(needle) || (t.venue ?? "").toLowerCase().includes(needle)),
  );
  const hasAny = (tickets?.length ?? 0) > 0;

  return (
    <div>
      <h1 className="font-display text-4xl font-bold tracking-tight">My tickets</h1>
      <div className="mt-4">
        <ErrorBanner message={error} />
      </div>

      {shifts.length > 0 && (
        <section className="mt-6">
          <h2 className="label">Your door shifts</h2>
          <ul className="space-y-2">
            {shifts.map((e) => (
              <li key={e.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="min-w-0">
                  <span className="font-semibold">{e.title}</span>
                  <span className="block text-sm text-muted">
                    {eventTime(e.starts_at, e.timezone)}
                    {e.venue ? ` · ${e.venue}` : ""}
                  </span>
                </span>
                <Link href={`/scan/${e.id}`} className="btn-primary !py-1.5">
                  Open scanner
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {holds.length > 0 && (
        <section className="mt-6">
          <h2 className="label">Unpaid holds</h2>
          <ul className="space-y-2">
            {holds.map((h) => (
              <li key={h.id} className="card flex items-center justify-between p-4">
                <span>
                  <span className="font-semibold">{h.event_title}</span>
                  <span className="text-muted">
                    {" "}
                    · {h.quantity} × {h.ticket_type} · {money(h.total_cents)}
                  </span>
                </span>
                <Link href={`/checkout/${h.id}`} className="btn-primary !py-1.5">
                  Finish checkout
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasAny && (
        <div className="mt-8 flex flex-wrap items-center gap-3 border-b border-line pb-6">
          <Segmented
            label="Show"
            value={tab}
            onChange={(v) => {
              setTab(v);
              setScan("all");
            }}
            options={[
              { value: "upcoming", label: "Upcoming", count: groups.upcoming.length },
              { value: "past", label: "Past", count: groups.past.length },
              { value: "cancelled", label: "Cancelled", count: groups.cancelled.length },
            ]}
          />
          {tab !== "cancelled" && (
            <Segmented
              label="Scan status"
              value={scan}
              onChange={setScan}
              options={[
                { value: "all", label: "All" },
                { value: "unused", label: "Not scanned" },
                { value: "used", label: "Scanned" },
              ]}
            />
          )}
          <SearchBox value={q} onChange={setQ} placeholder="Search by event or venue" label="Search tickets" />
        </div>
      )}

      {hasAny && shown.length === 0 && (
        <p className="card mt-6 p-8 text-center text-muted">
          {needle || scan !== "all"
            ? "No tickets match those filters."
            : tab === "upcoming"
              ? "Nothing coming up. Your past tickets are under Past."
              : tab === "past"
                ? "No past events yet."
                : "No cancelled or refunded tickets."}
        </p>
      )}

      {tickets && !hasAny && holds.length === 0 && (
        <div className="card mt-8 p-10 text-center">
          <p className="font-display text-xl font-semibold">No tickets yet</p>
          <Link href="/events" className="btn-primary mt-4">
            Find an event
          </Link>
        </div>
      )}

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {shown.map((t) => (
          <li key={t.id} className="card overflow-hidden">
            <div className="flex items-start justify-between gap-4 p-5">
              <div className="min-w-0">
                <Link href={`/events/${t.event_id}`} className="font-display text-lg font-semibold hover:text-accent">
                  {t.event_title}
                </Link>
                <p className="text-sm text-muted">{eventTime(t.starts_at, t.timezone)}</p>
                <p className="text-sm text-muted">{t.venue ?? "Venue TBA"}</p>
              </div>
              <StatusPill status={t.status} />
            </div>
            <div className="slot-rule-light" />
            <div className="flex items-center justify-between gap-4 p-5">
              <div>
                <div className="label">Admit one</div>
                <div className="font-semibold">{t.ticket_type}</div>
                <div className="mt-1 font-mono text-[11px] text-muted">#{t.id.slice(0, 8).toUpperCase()}</div>
                {t.status === "confirmed" && tab === "upcoming" && (
                  <button className="mt-3 text-xs text-muted underline hover:text-bad" onClick={() => refund(t.order_id)}>
                    Refund order
                  </button>
                )}
              </div>
              {t.status === "confirmed" && tab === "past" && (
                <span className="text-sm text-muted">Not scanned. The event has ended.</span>
              )}
              {t.qr && t.status === "confirmed" && tab === "upcoming" && (
                <button onClick={() => setOpen(t.id)} aria-label="Enlarge QR code">
                  <QrImage value={t.qr} size={112} />
                </button>
              )}
              {t.status === "checked_in" && (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                  <CheckIcon className="h-4 w-4" /> Scanned in
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {open && (
        <div
          className="fixed inset-0 z-30 grid place-items-center bg-black/70 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-label="QR code"
        >
          <div className="rounded-xl bg-white p-4">
            <QrImage value={tickets!.find((t) => t.id === open)!.qr!} size={300} />
            <p className="mt-2 text-center text-sm text-black/70">Turn your brightness up. Tap to close.</p>
          </div>
        </div>
      )}
    </div>
  );
}
