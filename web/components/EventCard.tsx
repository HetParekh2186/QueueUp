import Link from "next/link";
import { eventDay, eventTime, money } from "@/lib/format";
import type { EventSummary } from "@/lib/types";

export function EventCard({ e }: { e: EventSummary }) {
  const d = eventDay(e.starts_at, e.timezone);
  const soldOut = e.remaining <= 0;
  const low = !soldOut && e.capacity > 0 && e.remaining / e.capacity <= 0.1;
  return (
    <Link href={`/events/${e.id}`} className="card group flex h-full overflow-hidden transition hover:border-ink">
      <div className="flex w-20 shrink-0 flex-col items-center justify-center border-r border-dashed border-line bg-paper py-4">
        <span className="font-mono text-xs font-semibold text-accent">{d.month}</span>
        <span className="font-display text-3xl font-bold leading-none">{d.day}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <h2 className="truncate font-display text-lg font-semibold group-hover:text-accent">{e.title}</h2>
        {e.is_demo && (
          <span className="mt-1 self-start rounded-[2px] border border-line px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            Demo event
          </span>
        )}
        <p className="truncate text-sm text-muted">{e.venue ?? "Venue TBA"}</p>
        <p className="mt-1 text-xs text-muted">{eventTime(e.starts_at, e.timezone)}</p>
        <div className="mt-auto flex items-end justify-between pt-4">
          <span className="text-sm font-semibold">
            {e.min_price_cents === null ? "—" : `from ${money(e.min_price_cents)}`}
          </span>
          <span className={`font-mono text-xs font-semibold ${soldOut ? "text-bad" : low ? "text-warn" : "text-muted"}`}>
            {soldOut ? "SOLD OUT" : `${e.remaining} left`}
          </span>
        </div>
      </div>
    </Link>
  );
}
