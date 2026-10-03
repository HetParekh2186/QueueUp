import Link from "next/link";
import { AlertIcon, ArrowIcon, CheckIcon, CrossIcon } from "@/components/icons";
import { Wordmark } from "@/components/Nav";
import { RaceBoard } from "@/components/RaceBoard";
import { PUBLIC_API_URL, serverApi } from "@/lib/api";
import { eventDay, eventTime } from "@/lib/format";
import type { EventSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

const HOST_HREF = "/organizer/new";
const FIND_HREF = "/events";

/* Spacing in board modules (--m, the slot pitch). */
const WRAP = "mx-auto max-w-6xl px-[calc(var(--m)*0.75)] sm:px-[var(--m)]";
const H2 = "font-stencil text-[clamp(2.2rem,4.6vw,3.75rem)] font-extrabold uppercase leading-[0.92] [text-wrap:balance]";
const PLATE_BTN =
  "group flex items-center justify-between gap-2 rounded-[3px] bg-plate px-4 py-3.5 font-display text-lg font-extrabold uppercase tracking-[0.06em] text-plate-ink transition-colors hover:bg-white";
const BOARD_LINK =
  "inline-flex items-center gap-1.5 font-display text-base font-bold uppercase tracking-[0.1em] text-board-text underline decoration-bulb decoration-2 underline-offset-[6px] hover:text-bulb";

/** Both paths get the same enamel plate: amber is reserved for "lit / live", never for a favourite. */
function Ctas() {
  return (
    <div className="grid max-w-md gap-[calc(var(--m)/2)] min-[440px]:grid-cols-2">
      <Link href={HOST_HREF} className={PLATE_BTN}>
        Host an event
        <ArrowIcon className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>
      <Link href={FIND_HREF} className={PLATE_BTN}>
        Find an event
        <ArrowIcon className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function SlotRule() {
  return <div className={`slot-rule ${WRAP}`} aria-hidden />;
}

/** The board's two marks: a lit bulb (won) and a dashed out cell (lost), at matrix scale. */
function Lit() {
  return <span className="h-6 w-6 shrink-0 rounded-full bg-bulb" aria-hidden />;
}
function Out() {
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

const STEPS = [
  { n: 1, word: "Hold", line: "Ten minutes. The seat is yours." },
  { n: 2, word: "Pay", line: "Inside the window, or it's resold." },
  { n: 3, word: "Scan", line: "Signed QR. Forgeries fail." },
  { n: 4, word: "In", line: "Counted live, exactly once." },
];

export default async function Landing() {
  const data = await serverApi<{ items: EventSummary[] }>("/events?limit=5");
  const events = data?.items;
  const anyDemo = events?.some((e) => e.is_demo);

  return (
    <div className="bg-board text-board-text">
      {/* ---------------------------------------------------------------- the race */}
      <section
        className={`${WRAP} grid items-center gap-[calc(var(--m)*2)] pb-[calc(var(--m)*3)] pt-[calc(var(--m)*2)] lg:grid-cols-[1.3fr_1fr] lg:pb-[calc(var(--m)*4)] lg:pt-[calc(var(--m)*3)]`}
      >
        <div>
          <h1 className="font-stencil text-[clamp(3rem,5.4vw,4.75rem)] font-extrabold uppercase leading-[0.9] tracking-[-0.01em]">
            <span className="block lg:whitespace-nowrap">One seat.</span>
            <span className="block lg:whitespace-nowrap">A hundred hands.</span>
            <span className="block text-bulb lg:whitespace-nowrap">Exactly one ticket.</span>
          </h1>
          <p className="mt-[var(--m)] max-w-[34rem] text-lg leading-relaxed text-board-text/90">
            QueueUp sells a fixed number of tickets, holds each seat while its buyer pays, and checks people in at the
            door by QR. When everyone grabs the last ticket at once, exactly one person gets it, and everyone else is
            told why.
          </p>
          <div className="mt-[calc(var(--m)*1.5)]">
            <Ctas />
          </div>
          <p className="mt-[calc(var(--m)/2)] text-sm text-board-muted">Free to try. Payments use simulated test cards.</p>
        </div>

        <div>
          <RaceBoard />
          <p className="mt-[calc(var(--m)/2)] text-xs leading-relaxed text-board-muted">
            An illustration of the test that runs on every push:{" "}
            <code className="font-mono text-[11px] text-board-text">test_100_buyers_race_for_the_last_seat</code>.
            Not live traffic.
          </p>
        </div>
      </section>

      <SlotRule />

      {/* ----------------------------------------------------------- line score */}
      <section className={`${WRAP} board-section`} aria-labelledby="line-score">
        <h2 id="line-score" className={`max-w-3xl ${H2}`}>
          Every race has one winner. The other side hears why.
        </h2>
        <p className="mt-[calc(var(--m)*0.75)] max-w-2xl text-board-text/85">
          Each check and its write happen in one guarded database step, so there is no gap for a second buyer to slip
          through.
        </p>

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
        <p className="mt-[var(--m)] text-sm text-board-muted">
          Every row is a test in the suite, run against a real PostgreSQL database on every push.
        </p>
      </section>

      {/* -------------------------------------------------------------- the steps */}
      <section className="bg-plate text-plate-ink" aria-labelledby="steps">
        <div className={`${WRAP} board-section`}>
          <h2 id="steps" className={H2}>
            How a ticket moves
          </h2>
          <ol className="mt-[calc(var(--m)*2)] flex flex-wrap items-start gap-x-[calc(var(--m)*1.5)] gap-y-[calc(var(--m)*1.5)]">
            {STEPS.map((s, i) => (
              <li key={s.n} className="flex items-start gap-[calc(var(--m)*1.5)]">
                <div className="flex w-[calc(var(--m)*6)] flex-col sm:w-[calc(var(--m)*8)]">
                  <span className="grid h-[calc(var(--m)*6)] place-items-center rounded-[4px] bg-board font-display text-[7.5rem] font-extrabold leading-none text-plate tabular sm:h-[calc(var(--m)*8)] sm:text-[10rem]">
                    {s.n}
                  </span>
                  <span className="mt-[calc(var(--m)/2)] font-stencil text-3xl font-extrabold uppercase sm:text-4xl">{s.word}</span>
                  <span className="mt-1 text-plate-ink/80">{s.line}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <ArrowIcon className="mt-[calc(var(--m)*3.5)] hidden h-8 w-8 shrink-0 text-board xl:block" />
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------- the lineup */}
      <section className={`${WRAP} board-section`} aria-labelledby="lineup">
        <h2 id="lineup" className={`max-w-3xl ${H2}`}>
          One system, both sides of the door.
        </h2>

        <div className="mt-[calc(var(--m)*2)] divide-y divide-board-rule border-y border-board-rule">
          <div className="grid gap-[calc(var(--m)*0.75)] py-[calc(var(--m)*1.5)] md:grid-cols-[calc(var(--m)*10)_1fr_auto] md:items-center md:gap-[var(--m)]">
            <h3 className="font-display text-3xl font-extrabold uppercase tracking-[0.02em]">Organizers</h3>
            <p className="max-w-xl leading-relaxed text-board-text/90">
              Set ticket tiers and capacity, publish, and assign door staff by email. Watch sales and check-ins climb on a
              live board, and export the attendee list when you&apos;re done.
            </p>
            <Link href={HOST_HREF} className={BOARD_LINK}>
              Host an event <ArrowIcon className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-[calc(var(--m)*0.75)] py-[calc(var(--m)*1.5)] md:grid-cols-[calc(var(--m)*10)_1fr] md:items-center md:gap-[var(--m)]">
            <h3 className="font-display text-3xl font-extrabold uppercase tracking-[0.02em]">Door staff</h3>
            <div>
              <p className="max-w-xl leading-relaxed text-board-text/90">
                Open the scanner in your phone&apos;s browser, with no app to install. Point it at a ticket and get a
                verdict you can read at arm&apos;s length.
              </p>
              <ul className="mt-[calc(var(--m)*0.75)] flex flex-wrap gap-2" aria-label="Scanner verdicts">
                <li className="inline-flex items-center gap-2 rounded-[3px] bg-bulb px-3 py-2 font-display text-base font-extrabold uppercase tracking-[0.08em] text-plate-ink">
                  <CheckIcon className="h-5 w-5" /> Admitted
                </li>
                <li className="inline-flex items-center gap-2 rounded-[3px] bg-plate px-3 py-2 font-display text-base font-extrabold uppercase tracking-[0.08em] text-plate-ink">
                  <AlertIcon className="h-5 w-5" /> Already in
                </li>
                <li className="inline-flex items-center gap-2 rounded-[3px] px-3 py-2 font-display text-base font-extrabold uppercase tracking-[0.08em] text-board-text outline outline-[1.5px] -outline-offset-2 outline-dashed outline-out">
                  <CrossIcon className="h-5 w-5 text-out" /> Rejected
                </li>
              </ul>
            </div>
          </div>

          <div className="grid gap-[calc(var(--m)*0.75)] py-[calc(var(--m)*1.5)] md:grid-cols-[calc(var(--m)*10)_1fr_auto] md:items-center md:gap-[var(--m)]">
            <h3 className="font-display text-3xl font-extrabold uppercase tracking-[0.02em]">Attendees</h3>
            <p className="max-w-xl leading-relaxed text-board-text/90">
              Watch the seats left tick down as other people buy. Reserve, pay before the hold runs out, and keep your QR
              code in My Tickets.
            </p>
            <Link href={FIND_HREF} className={BOARD_LINK}>
              Find an event <ArrowIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- on sale right now */}
      {events && (
        <section className="bg-board-deep" aria-labelledby="on-sale">
          <div className={`${WRAP} board-section`}>
            <div className="flex flex-wrap items-end justify-between gap-[var(--m)]">
              <h2 id="on-sale" className={H2}>
                On sale now
              </h2>
              <Link href={FIND_HREF} className={BOARD_LINK}>
                All events <ArrowIcon className="h-4 w-4" />
              </Link>
            </div>

            {events.length === 0 ? (
              <div className="mt-[calc(var(--m)*1.5)] flex flex-wrap items-center justify-between gap-[var(--m)] border-y border-board-rule py-[calc(var(--m)*1.5)]">
                <p className="text-lg text-board-text/90">Nothing is on sale yet. The board is waiting for its first event.</p>
                <Link
                  href={HOST_HREF}
                  className="rounded-[3px] bg-plate px-4 py-2.5 font-display text-base font-extrabold uppercase tracking-[0.06em] text-plate-ink hover:bg-white"
                >
                  Host the first one
                </Link>
              </div>
            ) : (
              <>
                <ul className="mt-[calc(var(--m)*1.5)] divide-y divide-board-rule border-y border-board-rule">
                  {events.map((e) => {
                    const d = eventDay(e.starts_at, e.timezone);
                    const soldOut = e.remaining <= 0;
                    return (
                      <li key={e.id}>
                        <Link
                          href={`/events/${e.id}`}
                          className="group grid grid-cols-[calc(var(--m)*3)_1fr_auto] items-center gap-[calc(var(--m)*0.75)] py-[calc(var(--m)*0.75)] sm:gap-[var(--m)]"
                        >
                          <span className="flex flex-col items-center rounded-[3px] bg-board py-1.5">
                            <span className="font-display text-xs font-bold tracking-[0.14em] text-bulb">{d.month}</span>
                            <span className="font-display text-3xl font-extrabold leading-none">{d.day}</span>
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
                              <span className="max-w-full break-words font-display text-2xl font-extrabold uppercase leading-tight tracking-[0.02em] group-hover:text-bulb sm:truncate">
                                {e.title}
                              </span>
                              {e.is_demo && (
                                <span className="shrink-0 rounded-[2px] border border-board-rule px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-board-muted">
                                  Demo event
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block text-sm text-board-text/75 sm:truncate">
                              {eventTime(e.starts_at, e.timezone)}
                              {e.venue ? ` · ${e.venue}` : ""}
                            </span>
                          </span>
                          {soldOut ? (
                            <span className="rounded-[3px] px-2.5 py-1.5 font-display text-sm font-extrabold uppercase tracking-[0.1em] outline outline-[1.5px] -outline-offset-2 outline-dashed outline-out">
                              Sold out
                            </span>
                          ) : (
                            <span className="flex flex-col items-end gap-1">
                              <span className="plate-num px-2 py-1 text-2xl">{e.remaining}</span>
                              <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-board-muted">
                                seats left
                              </span>
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {anyDemo && (
                  <p className="mt-[calc(var(--m)/2)] text-sm text-board-muted">
                    Events marked Demo are seeded demonstration data. Buying one uses simulated test cards.
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- the close */}
      <section className={`${WRAP} board-section grid items-center gap-[calc(var(--m)*2)] lg:grid-cols-[1fr_auto]`}>
        <div>
          <h2 className="max-w-4xl font-stencil text-[clamp(2.6rem,6vw,5rem)] font-extrabold uppercase leading-[0.9] [text-wrap:balance]">
            Your event. <span className="text-bulb">Exactly as many tickets as seats.</span>
          </h2>
          <div className="mt-[calc(var(--m)*2)]">
            <Ctas />
          </div>
        </div>
        <div
          className="order-first flex items-center gap-[calc(var(--m)*0.75)] lg:order-none lg:flex-col lg:gap-2 lg:justify-self-end"
          aria-label="Oversold: zero, in every test run"
        >
          <span className="hidden font-display text-sm font-bold uppercase tracking-[0.14em] text-board-muted lg:block">Oversold</span>
          <span className="plate-num grid h-[calc(var(--m)*4)] w-[calc(var(--m)*3)] shrink-0 place-items-center text-[5rem] lg:h-[calc(var(--m)*7)] lg:w-[calc(var(--m)*6)] lg:text-[9rem]">
            0
          </span>
          <span className="flex flex-col font-display font-bold uppercase tracking-[0.14em] text-board-muted lg:items-center">
            <span className="text-2xl text-board-text lg:hidden">Oversold</span>
            <span className="text-xs">in every test run</span>
          </span>
        </div>
      </section>

      <SlotRule />

      <footer>
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-[var(--m)] py-[calc(var(--m)*1.5)] text-sm text-board-text/75`}>
          <Wordmark className="text-lg text-board-text" />
          <p>A portfolio project. Payments use simulated test cards, and no real money moves.</p>
          <nav className="flex gap-5 font-display text-sm font-bold uppercase tracking-[0.1em]">
            <Link href={FIND_HREF} className="hover:text-bulb">
              Events
            </Link>
            <a href={`${PUBLIC_API_URL}/docs`} className="hover:text-bulb">
              API docs
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
