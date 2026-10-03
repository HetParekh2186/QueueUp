"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBanner, LiveDot, StatusPill } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { eventTime, money, uuid } from "@/lib/format";
import type { EventDetail, Order, WaitlistEntry } from "@/lib/types";
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
  const [mine, setMine] = useState<WaitlistEntry[]>([]);
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

  // Your places in line for this event. While you're waiting, check every 20s so a
  // seat held for you shows up without a refresh.
  const loadMine = useCallback(() => {
    if (!user) return setMine([]);
    api<WaitlistEntry[]>("/me/waitlist")
      .then((all) => setMine(all.filter((e) => e.event_id === id && (e.status === "waiting" || e.status === "offered"))))
      .catch(() => {});
  }, [id, user]);
  useEffect(loadMine, [loadMine]);
  const waitingHere = mine.some((e) => e.status === "waiting");
  useEffect(() => {
    if (!waitingHere) return;
    const t = setInterval(loadMine, 20_000);
    return () => clearInterval(t);
  }, [waitingHere, loadMine]);

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
  const entry = type ? mine.find((e) => e.ticket_type_id === type.id) : undefined;
  const soldOut = Boolean(type && type.remaining <= 0);

  async function joinWaitlist() {
    if (!user) {
      router.push(`/login?next=/events/${id}`);
      return;
    }
    if (!type) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/events/${id}/waitlist`, { method: "POST", body: { ticket_type_id: type.id, quantity } });
      loadMine();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function leaveWaitlist(entryId: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/waitlist/${entryId}`, { method: "DELETE" });
      loadMine();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

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
                    disabled={!onSale}
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
                      {out && t.waiting > 0 && (
                        <span className="block text-right text-[11px] font-normal text-muted">{t.waiting} waiting</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="slot-rule-light" />

          <div className="space-y-3 p-5">
            {onSale && entry?.status === "offered" ? (
              <div className="space-y-3 text-center">
                <p className="font-display text-xl font-bold uppercase tracking-[0.04em] text-ok">A seat is held for you</p>
                <p className="text-sm text-muted">
                  Someone gave theirs up and you were next in line. Pay by{" "}
                  <span className="font-semibold text-ink">
                    {new Date(entry.offer_expires_at!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>{" "}
                  or it passes to the next person.
                </p>
                <Link href={`/checkout/${entry.order_id}`} className="btn-primary w-full">
                  Finish checkout
                </Link>
              </div>
            ) : onSale && entry?.status === "waiting" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <span className="plate-num grid h-14 min-w-12 place-items-center px-2 text-3xl">{entry.position}</span>
                  <div>
                    <p className="font-display text-lg font-bold uppercase leading-tight tracking-[0.04em]">
                      You&apos;re #{entry.position} in line
                    </p>
                    <p className="text-sm text-muted">
                      For {entry.quantity} × {entry.ticket_type}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-muted">
                  When a seat frees up it&apos;s held for you automatically, first come first served. You&apos;ll have 15
                  minutes to pay. It shows up here and in My tickets.
                </p>
                <ErrorBanner message={error} />
                <button className="btn-ghost w-full" disabled={busy} onClick={() => leaveWaitlist(entry.id)}>
                  Leave the waitlist
                </button>
              </div>
            ) : onSale && soldOut ? (
              <>
                <div className="flex items-center justify-between">
                  <label htmlFor="wqty" className="label !mb-0">
                    Seats wanted
                  </label>
                  <select id="wqty" className="input !w-24" value={Math.min(quantity, 4)} onChange={(e) => setQuantity(Number(e.target.value))}>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <ErrorBanner message={error} />
                <button className="btn-primary w-full" disabled={busy || !type} onClick={joinWaitlist}>
                  {busy ? "Joining…" : user ? "Join the waitlist" : "Log in to join the waitlist"}
                </button>
                <p className="text-center text-xs text-muted">
                  {type && type.waiting > 0 ? `${type.waiting} ahead of you. ` : ""}If a seat frees up, it&apos;s held for
                  you automatically.
                </p>
              </>
            ) : onSale ? (
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
