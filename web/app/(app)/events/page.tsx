import Link from "next/link";
import { serverApi } from "@/lib/api";
import { eventDay, eventTime, money } from "@/lib/format";
import type { EventSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

type Page = { items: EventSummary[]; next_cursor: string | null };

export const metadata = { title: "Events" };

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const page = await serverApi<Page>(`/events?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);

  return (
    <div>
      <section className="mb-10 border-b border-line pb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Upcoming events</h1>
        <p className="mt-2 max-w-xl text-muted">
          Reserve a seat, pay within the hold window, and walk in with a QR code. Seat counts update live.
        </p>
      </section>

      {page === null && (
        <p className="card p-6 text-muted">The event service is unavailable right now. Try refreshing in a moment.</p>
      )}
      {page && page.items.length === 0 && (
        <div className="card p-10 text-center">
          <p className="font-display text-xl font-semibold">No events on sale yet</p>
          <p className="mt-1 text-muted">Organizers can publish one from the Organize tab.</p>
        </div>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {page?.items.map((e) => {
          const d = eventDay(e.starts_at, e.timezone);
          const soldOut = e.remaining <= 0;
          const low = !soldOut && e.capacity > 0 && e.remaining / e.capacity <= 0.1;
          return (
            <li key={e.id}>
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
                    <span
                      className={`font-mono text-xs font-semibold ${soldOut ? "text-bad" : low ? "text-warn" : "text-muted"}`}
                    >
                      {soldOut ? "SOLD OUT" : `${e.remaining} left`}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {page?.next_cursor && (
        <div className="mt-8 text-center">
          <Link href={`/events?cursor=${encodeURIComponent(page.next_cursor)}`} className="btn-ghost">
            More events
          </Link>
        </div>
      )}
    </div>
  );
}
