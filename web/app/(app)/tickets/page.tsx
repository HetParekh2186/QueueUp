"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorBanner, QrImage, RequireAuth, StatusPill } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { eventTime, money } from "@/lib/format";
import type { Order, Ticket } from "@/lib/types";

export default function TicketsPage() {
  return (
    <RequireAuth>
      <Tickets />
    </RequireAuth>
  );
}

function Tickets() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [holds, setHolds] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api<Ticket[]>("/me/tickets"), api<Order[]>("/me/holds")])
      .then(([t, h]) => {
        setTickets(t);
        setHolds(h);
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

  const upcoming = tickets?.filter((t) => t.status !== "cancelled") ?? [];
  const cancelled = tickets?.filter((t) => t.status === "cancelled") ?? [];

  return (
    <div>
      <h1 className="font-display text-4xl font-bold tracking-tight">My tickets</h1>
      <div className="mt-4">
        <ErrorBanner message={error} />
      </div>

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

      {tickets && upcoming.length === 0 && holds.length === 0 && (
        <div className="card mt-8 p-10 text-center">
          <p className="font-display text-xl font-semibold">No tickets yet</p>
          <Link href="/events" className="btn-primary mt-4">
            Find an event
          </Link>
        </div>
      )}

      <ul className="mt-8 grid gap-4 md:grid-cols-2">
        {upcoming.map((t) => (
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
                {t.status === "confirmed" && (
                  <button className="mt-3 text-xs text-muted underline hover:text-bad" onClick={() => refund(t.order_id)}>
                    Refund order
                  </button>
                )}
              </div>
              {t.qr && t.status === "confirmed" && (
                <button onClick={() => setOpen(t.id)} aria-label="Enlarge QR code">
                  <QrImage value={t.qr} size={112} />
                </button>
              )}
              {t.status === "checked_in" && <span className="text-sm text-muted">Scanned in ✓</span>}
            </div>
          </li>
        ))}
      </ul>

      {cancelled.length > 0 && (
        <p className="mt-8 text-sm text-muted">
          {cancelled.length} cancelled or refunded ticket{cancelled.length > 1 ? "s" : ""} hidden.
        </p>
      )}

      {open && (
        <div
          className="fixed inset-0 z-30 grid place-items-center bg-black/70 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-label="QR code"
        >
          <div className="rounded-xl bg-white p-4">
            <QrImage value={upcoming.find((t) => t.id === open)!.qr!} size={300} />
            <p className="mt-2 text-center text-sm text-black/70">Turn your brightness up. Tap to close.</p>
          </div>
        </div>
      )}
    </div>
  );
}
