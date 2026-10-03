/** Event-list filters as they live in the URL (/events?q=jazz&when=week&price=free&open=1). */
export type EventFilters = {
  q: string;
  when: "any" | "week" | "month";
  price: "any" | "free" | "paid";
  open: boolean; // hide sold-out events
};

export const DEFAULT_FILTERS: EventFilters = { q: "", when: "any", price: "any", open: false };

type Raw = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseFilters(raw: Raw): EventFilters {
  const when = one(raw.when);
  const price = one(raw.price);
  return {
    q: one(raw.q).slice(0, 100),
    when: when === "week" || when === "month" ? when : "any",
    price: price === "free" || price === "paid" ? price : "any",
    open: one(raw.open) === "1",
  };
}

/** The URL search string for a set of filters (defaults omitted, so links stay clean). */
export function filtersToSearch(f: EventFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.when !== "any") p.set("when", f.when);
  if (f.price !== "any") p.set("price", f.price);
  if (f.open) p.set("open", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The API query for a set of filters. Date windows are resolved once, on the server
 *  render, and reused for every "More events" page so later pages can't drift. */
export function filtersToApiQuery(f: EventFilters, now: Date = new Date()): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.when !== "any") {
    const days = f.when === "week" ? 7 : 30;
    p.set("starts_after", now.toISOString());
    p.set("starts_before", new Date(now.getTime() + days * 86_400_000).toISOString());
  }
  if (f.price !== "any") p.set("price", f.price);
  if (f.open) p.set("available", "true");
  return p.toString();
}

export function isFiltered(f: EventFilters): boolean {
  return Boolean(f.q.trim()) || f.when !== "any" || f.price !== "any" || f.open;
}
