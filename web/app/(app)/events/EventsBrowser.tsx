"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { EventCard } from "@/components/EventCard";
import { SearchBox, Segmented, Toggle } from "@/components/Filters";
import { ErrorBanner } from "@/components/ui";
import { PUBLIC_API_URL } from "@/lib/api";
import { DEFAULT_FILTERS, type EventFilters, filtersToSearch, isFiltered } from "@/lib/eventFilters";
import type { EventSummary } from "@/lib/types";

type Page = { items: EventSummary[]; next_cursor: string | null };

export function EventsBrowser({
  filters,
  apiQuery,
  initial,
}: {
  filters: EventFilters;
  /** Filter query resolved by the server render; reused for every later page. */
  apiQuery: string;
  initial: Page | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState(initial?.items ?? []);
  const [cursor, setCursor] = useState(initial?.next_cursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [q, setQ] = useState(filters.q);
  const firstNew = useRef<HTMLLIElement>(null);
  const appendedFrom = useRef<number | null>(null);

  // New filters mean a new first page from the server: start the list over. (Not a
  // remount, so the search box keeps focus while you type.) Keyed on the query too:
  // the router cache can hand back the same page object when you return to a filter
  // combination you've already seen.
  useEffect(() => {
    setItems(initial?.items ?? []);
    setCursor(initial?.next_cursor ?? null);
    setMoreError(null);
  }, [initial, apiQuery]);

  function apply(next: Partial<EventFilters>) {
    const merged = { ...filters, q, ...next };
    startTransition(() => router.replace(`/events${filtersToSearch(merged)}`, { scroll: false }));
  }

  // Search as you type, debounced so each keystroke isn't a request.
  useEffect(() => {
    if (q === filters.q) return;
    const t = setTimeout(() => apply({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // After appending, move focus to the first new card so keyboard users keep their place.
  useEffect(() => {
    if (appendedFrom.current !== null) {
      firstNew.current?.querySelector("a")?.focus({ preventScroll: true });
      appendedFrom.current = null;
    }
  }, [items.length]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const qs = `${apiQuery ? `${apiQuery}&` : ""}limit=12&cursor=${encodeURIComponent(cursor)}`;
      const res = await fetch(`${PUBLIC_API_URL}/events?${qs}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as Page;
      appendedFrom.current = items.length;
      // A cursor never repeats rows, but guard against a double click racing itself.
      setItems((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...page.items.filter((e) => !seen.has(e.id))];
      });
      setCursor(page.next_cursor);
    } catch {
      setMoreError("Couldn't load more events. Check your connection and try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = isFiltered(filters);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center gap-3 border-b border-line pb-6">
        <SearchBox value={q} onChange={setQ} placeholder="Search events or venues" label="Search events" />
        <Segmented
          label="When"
          value={filters.when}
          onChange={(when) => apply({ when })}
          options={[
            { value: "any", label: "Any time" },
            { value: "week", label: "This week" },
            { value: "month", label: "This month" },
          ]}
        />
        <Segmented
          label="Price"
          value={filters.price}
          onChange={(price) => apply({ price })}
          options={[
            { value: "any", label: "Any price" },
            { value: "free", label: "Free" },
            { value: "paid", label: "Paid" },
          ]}
        />
        <Toggle label="Hide sold out" checked={filters.open} onChange={(open) => apply({ open })} />
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              startTransition(() => router.replace(`/events${filtersToSearch(DEFAULT_FILTERS)}`, { scroll: false }));
            }}
            className="font-display text-[13px] font-bold uppercase tracking-[0.08em] text-muted underline underline-offset-4 hover:text-ink"
          >
            Clear filters
          </button>
        )}
      </div>

      <div aria-busy={pending} className={`transition-opacity duration-150 ${pending ? "opacity-50" : ""}`}>
        {initial === null && (
          <p className="card p-6 text-muted">The event service is unavailable right now. Try refreshing in a moment.</p>
        )}
        {initial && items.length === 0 && (
          <div className="card p-10 text-center">
            {filtered ? (
              <>
                <p className="font-display text-xl font-semibold">No events match those filters</p>
                <p className="mt-1 text-muted">Try a wider date range, or clear the filters.</p>
              </>
            ) : (
              <>
                <p className="font-display text-xl font-semibold">No events on sale yet</p>
                <p className="mt-1 text-muted">Organizers can publish one from the Organize tab.</p>
              </>
            )}
          </div>
        )}

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((e, i) => (
            <li key={e.id} ref={i === appendedFrom.current ? firstNew : undefined}>
              <EventCard e={e} />
            </li>
          ))}
        </ul>

        <p className="sr-only" aria-live="polite">
          {items.length > 0 ? `Showing ${items.length} events${cursor ? "" : ", the end of the list"}.` : ""}
        </p>

        {moreError && (
          <div className="mt-6">
            <ErrorBanner message={moreError} />
          </div>
        )}
        {cursor && (
          <div className="mt-8 text-center">
            <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-ghost">
              {loadingMore ? "Loading…" : "More events"}
            </button>
          </div>
        )}
        {!cursor && items.length > 12 && (
          <p className="mt-8 text-center font-display text-sm font-bold uppercase tracking-[0.1em] text-muted">
            That&apos;s every event{filtered ? " matching your filters" : ""}
          </p>
        )}
      </div>
    </div>
  );
}
