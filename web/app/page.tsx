import Link from "next/link";
import { AlertIcon, ArrowIcon, CheckIcon, CrossIcon } from "@/components/icons";
import { BOARD_LINK, H2, PLATE_BTN, SiteFooter, SlotRule, WRAP } from "@/components/Board";
import { type PublicStats, TonightBoard } from "@/components/TonightBoard";
import { serverApi } from "@/lib/api";
import { eventDay, eventTime } from "@/lib/format";
import type { EventSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

const HOST_HREF = "/organizer/new";
const FIND_HREF = "/events";

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


const STEPS = [
  { n: 1, word: "Hold", line: "Ten minutes. The seat is yours." },
  { n: 2, word: "Pay", line: "Inside the window, or it's resold." },
  { n: 3, word: "Scan", line: "Signed QR. Forgeries fail." },
  { n: 4, word: "In", line: "Counted live, exactly once." },
];

export default async function Landing() {
  const [data, stats] = await Promise.all([
    serverApi<{ items: EventSummary[] }>("/events?limit=5"),
    serverApi<PublicStats>("/stats"),
  ]);
  const events = data?.items;
  const anyDemo = events?.some((e) => e.is_demo);

  return (
    <div className="bg-board text-board-text">
      {/* ------------------------------------------------------------- the board */}
      <section className={`${WRAP} pb-[calc(var(--m)*3)] pt-[calc(var(--m)*2)] lg:pb-[calc(var(--m)*4)] lg:pt-[calc(var(--m)*3)]`}>
        <div className="grid items-end gap-[calc(var(--m)*1.5)] lg:grid-cols-[1.25fr_1fr] lg:gap-[calc(var(--m)*2.5)]">
          <h1 className="font-stencil text-[clamp(3rem,6.4vw,5.5rem)] font-extrabold uppercase leading-[0.88] tracking-[-0.01em]">
            <span className="block">Run the door</span>
            <span className="block text-bulb">like a ballpark.</span>
          </h1>
          <div>
            <p className="max-w-[34rem] text-lg leading-relaxed text-board-text/90">
              Sell a set number of tickets, hold each seat while people pay, and scan everyone in at the door. The board
              keeps count, so no seat is ever sold twice.
            </p>
            <div className="mt-[var(--m)]">
              <Ctas />
            </div>
          </div>
        </div>

        <div className="mt-[calc(var(--m)*2)]">
          <TonightBoard initial={stats} />
        </div>
        <p className="mt-[calc(var(--m)*0.75)] flex flex-wrap items-center justify-between gap-3 text-sm text-board-muted">
          <span>Free to try. Payments use simulated test cards.</span>
          <Link href="/about" className={BOARD_LINK}>
            How it works <ArrowIcon className="h-4 w-4" />
          </Link>
        </p>
      </section>

      <SlotRule />

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

      <SiteFooter />
    </div>
  );
}
