"use client";

import { useEffect, useState } from "react";
import { PUBLIC_API_URL } from "@/lib/api";

export type PublicStats = {
  tickets_sold: number;
  checked_in: number;
  events_on_sale: number;
  includes_demo: boolean;
};

const POLL_MS = 10_000;
const fmt = new Intl.NumberFormat("en-US");

const PLATES: { key: keyof Omit<PublicStats, "includes_demo">; label: string; lit?: boolean }[] = [
  { key: "tickets_sold", label: "Tickets sold" },
  { key: "checked_in", label: "Checked in", lit: true },
  { key: "events_on_sale", label: "Events on sale" },
];

/** The landing hero's board: real platform totals on enamel plates, kept current. */
export function TonightBoard({ initial }: { initial: PublicStats | null }) {
  const [stats, setStats] = useState(initial);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`${PUBLIC_API_URL}/stats`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        setStats((await res.json()) as PublicStats);
        setLive(true);
      } catch {
        setLive(false); // keep showing the last numbers; just stop claiming they're live
      }
    };
    const start = () => {
      poll();
      timer = setInterval(poll, POLL_MS);
    };
    const stop = () => clearInterval(timer);
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!stats) return null;

  return (
    <figure className="rounded-[4px] bg-board-deep px-[var(--m)] py-[calc(var(--m)*1.25)] sm:px-[calc(var(--m)*1.5)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-display text-sm font-bold uppercase tracking-[0.14em] text-board-muted">
          Right now on QueueUp
        </span>
        <span className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-[0.14em] text-board-muted">
          <span className={`h-2.5 w-2.5 rounded-full ${live ? "bg-bulb" : "bg-bulb-off outline outline-1 outline-board-rule"}`} aria-hidden />
          {live ? "Live" : "Connecting"}
        </span>
      </div>

      <dl className="mt-[calc(var(--m)*1.25)] grid gap-[var(--m)] sm:grid-cols-3">
        {PLATES.map((p, i) => (
          <div key={p.key} className="flex items-center justify-between gap-4 sm:flex-col sm:items-stretch sm:justify-start">
            <dt
              className={`font-display text-sm font-bold uppercase tracking-[0.14em] sm:order-2 sm:mt-3 sm:text-center ${
                p.lit ? "text-bulb" : "text-board-text"
              }`}
            >
              {p.label}
            </dt>
            <dd className="sm:order-1 sm:w-full">
              {/* Keyed on the value: a changed number flips its plate, like a real board. */}
              <span
                key={stats[p.key]}
                className="plate-num plate-flip inline-block px-[calc(var(--m)/2)] py-[calc(var(--m)/4)] text-[5rem] sm:block sm:w-full sm:text-center sm:text-[clamp(5rem,9vw,9rem)]"
                style={{ animationDelay: `${i * 90}ms`, animationFillMode: "both" }}
              >
                {fmt.format(stats[p.key])}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <figcaption className="mt-[calc(var(--m)*1.25)] text-xs leading-relaxed text-board-muted">
        Totals across every event on the platform, refreshed every few seconds.
        {stats.includes_demo && " They include the clearly labeled demo events."}
      </figcaption>
    </figure>
  );
}
