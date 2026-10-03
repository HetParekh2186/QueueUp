"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorBanner, RequireAuth, StatusPill } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { money } from "@/lib/format";
import type { Order } from "@/lib/types";

export default function CheckoutPage() {
  return (
    <RequireAuth>
      <Checkout />
    </RequireAuth>
  );
}

function Checkout() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState("tok_visa");
  const [now, setNow] = useState(Date.now());
  const skew = useRef(0); // server clock minus browser clock

  useEffect(() => {
    api<Order>(`/orders/${orderId}`)
      .then((o) => {
        skew.current = new Date(o.server_now).getTime() - Date.now();
        setOrder(o);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [orderId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  if (error && !order) return <ErrorBanner message={error} />;
  if (!order) return <p className="py-24 text-center text-muted">Loading…</p>;

  // Cosmetic countdown, corrected for clock skew. The server's guarded UPDATE is the
  // only authority on whether the hold is still valid.
  const msLeft = new Date(order.expires_at).getTime() - (now + skew.current);
  const expired = order.status === "pending" && msLeft <= 0;
  const mins = Math.max(0, Math.floor(msLeft / 60000));
  const secs = Math.max(0, Math.floor((msLeft % 60000) / 1000));

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const paid = await api<Order>(`/orders/${orderId}/confirm`, { method: "POST", body: { payment_token: card } });
      setOrder(paid);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 410) setOrder((o) => o && { ...o, status: "expired" });
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setBusy(true);
    try {
      await api(`/orders/${orderId}`, { method: "DELETE" });
      router.push(`/events/${order!.event_id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link href={`/events/${order.event_id}`} className="text-sm text-muted hover:text-ink">
        ← {order.event_title}
      </Link>
      <div className="card mt-3 overflow-hidden">
        <div className="flex items-start justify-between p-6">
          <div>
            <h1 className="font-display text-2xl font-bold">
              {order.quantity} × {order.ticket_type}
            </h1>
            <p className="mt-1 font-mono text-lg">{money(order.total_cents)}</p>
          </div>
          <StatusPill status={expired ? "expired" : order.status} />
        </div>
        <div className="slot-rule-light" />

        {order.status === "pending" && !expired && (
          <div className="space-y-4 p-6">
            <div className="text-center">
              <div className="label">Seats held for</div>
              <div
                className={`font-mono text-5xl font-semibold tabular ${msLeft < 60000 ? "text-bad" : ""}`}
                aria-live="polite"
              >
                {mins}:{secs.toString().padStart(2, "0")}
              </div>
            </div>
            {order.total_cents > 0 && (
              <div>
                <label className="label" htmlFor="card">
                  Test card (simulated payment)
                </label>
                <select id="card" className="input" value={card} onChange={(e) => setCard(e.target.value)}>
                  <option value="tok_visa">Visa •••• 4242 — succeeds</option>
                  <option value="tok_decline">Visa •••• 0002 — declined</option>
                </select>
              </div>
            )}
            <ErrorBanner message={error} />
            <button className="btn-primary w-full" disabled={busy} onClick={pay}>
              {busy ? "Confirming…" : order.total_cents > 0 ? `Pay ${money(order.total_cents)}` : "Confirm free tickets"}
            </button>
            <button className="btn-ghost w-full" disabled={busy} onClick={release}>
              Release seats
            </button>
          </div>
        )}

        {(expired || order.status === "expired" || order.status === "cancelled") && (
          <div className="space-y-4 p-6 text-center">
            <ErrorBanner message={error} />
            <p className="text-muted">
              {order.status === "cancelled"
                ? "You released these seats."
                : "Your hold expired and the seats went back on sale."}
            </p>
            <Link href={`/events/${order.event_id}`} className="btn-primary">
              Reserve again
            </Link>
          </div>
        )}

        {order.status === "paid" && (
          <div className="space-y-4 p-6 text-center">
            <p className="font-display text-xl font-semibold text-ok">You&apos;re in.</p>
            <p className="text-muted">Your QR tickets are ready. Show them at the door.</p>
            <Link href="/tickets" className="btn-primary">
              View my tickets
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
