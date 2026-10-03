/* The "every race has one winner" line score: each race QueueUp settles, the guard
   that settles it, and what the winner and everyone else get. Used on /about. */

/** The board's two marks: a lit bulb (won) and a dashed out cell (lost), at matrix scale. */
export function Lit() {
  return <span className="h-6 w-6 shrink-0 rounded-full bg-bulb" aria-hidden />;
}
export function Out() {
  return <span className="h-6 w-6 shrink-0 rounded-full outline outline-2 -outline-offset-2 outline-dashed outline-out" aria-hidden />;
}

const RACES = [
  {
    race: "Two buyers, one seat",
    guard: "The ticket tier's row is locked while one buyer is served",
    win: "Holds the seat",
    lose: "Sold out",
    code: 409,
  },
  {
    race: "Paying as the hold runs out",
    guard: "The hold must still be valid at the instant of the write",
    win: "Ticket confirmed",
    lose: "Hold expired, card voided",
    code: 410,
  },
  {
    race: "One QR, two doors",
    guard: "The ticket must still be unscanned",
    win: "Admitted",
    lose: "Already in, with who and when",
    code: 409,
  },
  {
    race: "A double-clicked Reserve",
    guard: "Each request carries a one-time key",
    win: "One hold",
    lose: "Gets that same hold back",
    code: 409,
  },
  {
    race: "A refund racing the door",
    guard: "Every ticket on the order must still be unscanned",
    win: "Refunded",
    lose: "Already checked in",
    code: 409,
  },
];

export function LineScore() {
  return (
    <table className="mt-[calc(var(--m)*2)] w-full border-collapse text-left max-md:block">
      <thead className="max-md:hidden">
        <tr className="font-display text-xs font-bold uppercase tracking-[0.14em] text-board-muted">
          <th className="w-[calc(var(--m)*11)] pb-[calc(var(--m)/2)] pr-[var(--m)] font-bold">The race</th>
          <th className="pb-[calc(var(--m)/2)] pr-[var(--m)] font-bold">The guard</th>
          <th className="w-[calc(var(--m)*8)] pb-[calc(var(--m)/2)] pr-[var(--m)] font-bold">Winner</th>
          <th className="w-[calc(var(--m)*12)] pb-[calc(var(--m)/2)] font-bold">Everyone else</th>
        </tr>
      </thead>
      <tbody className="max-md:block">
        {RACES.map((r) => (
          <tr key={r.race} className="border-t border-board-rule align-middle max-md:block max-md:py-[var(--m)]">
            <th
              scope="row"
              className="py-[var(--m)] pr-[var(--m)] font-display text-2xl font-extrabold uppercase leading-none tracking-[0.02em] max-md:block max-md:py-0 max-md:pb-2"
            >
              {r.race}
            </th>
            <td className="py-[var(--m)] pr-[var(--m)] text-board-text/80 max-md:block max-md:py-1">{r.guard}</td>
            <td className="py-[var(--m)] pr-[var(--m)] max-md:block max-md:py-1">
              <span className="inline-flex items-center gap-2.5 font-medium">
                <Lit />
                {r.win}
              </span>
            </td>
            <td className="py-[var(--m)] max-md:block max-md:py-1">
              <span className="inline-flex items-center gap-2.5">
                <Out />
                <span className="plate-num px-1.5 py-0.5 text-sm">{r.code}</span>
                <span>{r.lose}</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
