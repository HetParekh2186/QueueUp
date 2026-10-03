"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorBanner, LiveDot, StatusPill } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { eventTime, money, uuid } from "@/lib/format";
import type { EventDetail, Order } from "@/lib/types";
import { useEventSocket } from "@/lib/useEventSocket";

export function EventView({ id, initial }: { id: string; initial: EventDetail | null }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [event, setEvent] = useState<EventDetail | null>(initial);
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // One key per *intent*: a double-click or a retry re-sends the same key, so the
  // server returns the original hold instead of creating a second one.
  const intentKey = useRef(uuid());

  useEffect(() => {
    if (!ready) return;
    api<EventDetail>(`/events/${id}`)
      .then(setEvent)
      .catch(() => {
        if (!initial) setMissing(true);
      });
  }, [id, ready, user, initial]);

  useEffect(() => {
    if (event && !selected) {
      const first = event.ticket_types.find((t) => t.remaining > 0) ?? event.ticket_types[0];
      if (first) setSelected(first.id);
    }
  }, [event, selected]);

  const live = useEventSocket(id, (msg) => {
    if (msg.type === "seats") {
      setEvent((e) =>
        e && {
          ...e,
          ticket_types: e.ticket_types.map((t) =>
            t.id === msg.ticket_type_id ? { ...t, remaining: msg.remaining, sold: msg.sold, capacity: msg.capacity } : t,
          ),
        },
      );
      setFlash(msg.ticket_type_id);
      setTimeout(() => setFlash(null), 900);
    } else if (msg.type === "event") {
      setEvent((e) => e && { ...e, status: msg.status });
    }
  });

  if (missing) return <p className="py-24 text-center text-muted">This event doesn&apos;t exist or isn&apos;t public.</p>;
  if (!event) return <p className="py-24 text-center text-muted">Loading…</p>;

  const type = event.ticket_types.find((t) => t.id === selected);
  const onSale = event.status === "published";
  const maxQty = Math.max(1, Math.min(10, type?.remaining ?? 1));

  async function reserve() {
    if (!user) {
      router.push(`/login?next=/events/${id}`);
      return;
    }
    if (!type) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api<Order>(`/events/${id}/reservations`, {
        method: "POST",
        body: { ticket_type_id: type.id, quantity, idempotency_key: intentKey.current },
      });
      router.push(`/checkout/${order.id}`);
    } catch (err) {
      const body = (err as { body?: { order_id?: string } }).body;
      if (body?.order_id) {
        router.push(`/checkout/${body.order_id}`); // replayed intent: resume that hold
        return;
      }
      intentKey.current = uuid(); // a failed attempt frees the key for a fresh try
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
      <article>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <StatusPill status={event.status} />
          <LiveDot on={live} />
        </div>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{event.title}</h1>
        <dl className="mt-6 grid gap-4 border-y border-line py-5 sm:grid-cols-2">
          <div>
            <dt className="label">When</dt>
            <dd className="font-medium">{eventTime(event.starts_at, event.timezone)}</dd>
            <dd className="text-xs text-muted">Shown in the venue&apos;s time zone ({event.timezone})</dd>
          </div>
          <div>
            <dt className="label">Where</dt>
            <dd className="font-medium">{event.venue ?? "Venue TBA"}</dd>
            <dd className="text-xs text-muted">Hosted by {event.organizer_name}</dd>
          </div>
        </dl>
        {event.description && <p className="mt-6 whitespace-pre-line leading-relaxed">{event.description}</p>}
        {(event.can_manage || event.can_scan) && (
          <div className="mt-8 flex flex-wrap gap-2">
            {event.can_manage && (
              <Link href={`/organizer/events/${event.id}`} className="btn-ghost">
                Manage event
              </Link>
            )}
            {event.can_scan && (
              <Link href={`/scan/${event.id}`} className="btn-ghost">
                Open door scanner
              </Link>
            )}
          </div>
        )}
      </article>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="card overflow-hidden">
          <div className="p-5">
            <h2 className="font-display text-lg font-semibold">Tickets</h2>
            {event.ticket_types.length === 0 && <p className="mt-2 text-sm text-muted">No tickets yet.</p>}
            <div className="mt-3 space-y-2" role="radiogroup" aria-label="Ticket type">
              {event.ticket_types.map((t) => {
                const out = t.remaining <= 0;
                return (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={selected === t.id}
                    disabled={out || !onSale}
                    onClick={() => {
                      setSelected(t.id);
                      setQuantity(1);
                    }}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-3 text-left transition disabled:opacity-50 ${
                      selected === t.id ? "border-ink" : "border-line hover:border-muted"
                    }`}
                  >
                    <span>
                      <span className="block font-semibold">{t.name}</span>
                      <span className="text-sm text-muted">{money(t.price_cents)}</span>
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-sm font-semibold tabular transition-colors duration-700 ${
                        flash === t.id ? "bg-accent text-accent-ink" : out ? "text-bad" : t.remaining <= 5 ? "text-warn" : "text-muted"
                      }`}
                    >
                      {out ? "Sold out" : `${t.remaining} left`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="slot-rule-light" />

          <div className="space-y-3 p-5">
            {onSale ? (
              <>
                <div className="flex items-center justify-between">
                  <label htmlFor="qty" className="label !mb-0">
                    Quantity
                  </label>
                  <select
                    id="qty"
                    className="input !w-24"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  >
                    {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Total</span>
                  <span className="font-mono text-lg font-semibold">{money((type?.price_cents ?? 0) * quantity)}</span>
                </div>
                <ErrorBanner message={error} />
                <button
                  className="btn-primary w-full"
                  disabled={busy || !type || type.remaining <= 0}
                  onClick={reserve}
                >
                  {busy ? "Reserving…" : user ? "Reserve" : "Log in to reserve"}
                </button>
                <p className="text-center text-xs text-muted">Seats are held for 10 minutes while you pay.</p>
              </>
            ) : (
              <p className="text-center text-sm text-muted">
                {event.status === "cancelled"
                  ? "This event was cancelled. Paid orders have been refunded."
                  : event.status === "ended"
                    ? "This event has ended."
                    : "Not on sale yet."}
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
