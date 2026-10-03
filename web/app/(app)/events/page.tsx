import { serverApi } from "@/lib/api";
import { filtersToApiQuery, parseFilters } from "@/lib/eventFilters";
import type { EventSummary } from "@/lib/types";
import { EventsBrowser } from "./EventsBrowser";

export const dynamic = "force-dynamic";

type Page = { items: EventSummary[]; next_cursor: string | null };

export const metadata = { title: "Events" };

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const apiQuery = filtersToApiQuery(filters);
  const page = await serverApi<Page>(`/events?${apiQuery ? `${apiQuery}&` : ""}limit=12`);

  return (
    <div>
      <section className="mb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Upcoming events</h1>
        <p className="mt-2 max-w-xl text-muted">
          Reserve a seat, pay within the hold window, and walk in with a QR code. Seat counts update live.
        </p>
      </section>
      <EventsBrowser filters={filters} apiQuery={apiQuery} initial={page} />
    </div>
  );
}
