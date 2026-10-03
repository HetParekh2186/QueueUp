import Link from "next/link";
import { H2, PLATE_BTN, SiteFooter, SlotRule, WRAP } from "@/components/Board";
import { ArrowIcon, CheckIcon, CrossIcon } from "@/components/icons";
import { LineScore, Lit, Out } from "@/components/LineScore";
import { RaceBoard } from "@/components/RaceBoard";
import { PUBLIC_API_URL } from "@/lib/api";

export const metadata = {
  title: "How it works",
  description: "How QueueUp makes sure the last ticket is sold exactly once, even when a hundred people try at the same moment.",
};

const REPO = "https://github.com/HetParekh2186/QueueUp";
const PROSE = "max-w-[62ch] text-lg leading-relaxed text-board-text/90";

/** One line of the naive-checkout story: who, what they saw, and the outcome mark. */
function Beat({ who, saw, mark }: { who: string; saw: string; mark: "ok" | "bad" }) {
  return (
    <li className="flex items-center gap-[calc(var(--m)*0.75)] border-t border-board-rule py-[calc(var(--m)*0.75)]">
      <span className="plate-num w-[calc(var(--m)*3)] shrink-0 px-2 py-1 text-center text-xl">{who}</span>
      <span className="flex-1 text-board-text/90">{saw}</span>
      {mark === "ok" ? (
        <CheckIcon className="h-6 w-6 shrink-0 text-bulb" title="Looks fine" />
      ) : (
        <CrossIcon className="h-6 w-6 shrink-0 text-out" title="Problem" />
      )}
    </li>
  );
}

const KEY = [
  { mark: <span className="h-6 w-6 shrink-0 rounded-full bg-bulb" aria-hidden />, text: "A bulb lights up: one buyer pressing “Reserve”. All 100 arrive within about a second." },
  {
    mark: <span className="h-6 w-6 shrink-0 rounded-full bg-bulb outline outline-2 outline-offset-2 outline-plate" aria-hidden />,
    text: "The ringed bulb: whoever reached the seat first. The database hands them the seat and holds everyone else back.",
  },
  { mark: <Out />, text: "A dashed red ring: a buyer who waited their turn, found the seat taken, and was told “sold out”." },
  {
    mark: <span className="plate-num px-1.5 py-0.5 text-sm">0</span>,
    text: "Oversold stays at zero. However the 100 arrive, one seat produces one ticket.",
  },
];

export default function About() {
  return (
    <div className="bg-board text-board-text">
      {/* ------------------------------------------------------------- intro */}
      <section className={`${WRAP} pb-[calc(var(--m)*3)] pt-[calc(var(--m)*2)] lg:pt-[calc(var(--m)*3)]`}>
        <h1 className="max-w-4xl font-stencil text-[clamp(3rem,6.4vw,5.5rem)] font-extrabold uppercase leading-[0.88] [text-wrap:balance]">
          How QueueUp sells <span className="text-bulb">the last seat once.</span>
        </h1>
        <p className={`mt-[var(--m)] ${PROSE}`}>
          When a popular event is down to its last ticket, lots of people press &ldquo;Reserve&rdquo; at the same moment.
          A ticketing system has one job then: give that seat to exactly one of them, and tell everyone else it&apos;s
          gone. Getting this wrong is called overselling, and it&apos;s harder to avoid than it sounds.
        </p>
      </section>

      <SlotRule />

      {/* ---------------------------------------------------------- the problem */}
      <section className={`${WRAP} board-section grid gap-[calc(var(--m)*2)] lg:grid-cols-2`} aria-labelledby="problem">
        <div>
          <h2 id="problem" className={H2}>
            The problem
          </h2>
          <p className={`mt-[var(--m)] ${PROSE}`}>
            A simple checkout looks at how many seats are left, then sells one. With one seat left and two buyers a split
            second apart, both can look before either one buys.
          </p>
        </div>
        <ol className="self-end border-b border-board-rule" aria-label="Two buyers, one seat, no protection">
          <Beat who="A" saw="Checks the seats left. Sees 1. Looks fine." mark="ok" />
          <Beat who="B" saw="Checks at the same moment. Also sees 1." mark="ok" />
          <Beat who="A" saw="Buys the seat." mark="ok" />
          <Beat who="B" saw="Buys the same seat. Two tickets, one chair." mark="bad" />
        </ol>
      </section>

      {/* --------------------------------------------------------------- the fix */}
      <section className="bg-plate text-plate-ink" aria-labelledby="fix">
        <div className={`${WRAP} board-section grid gap-[calc(var(--m)*2)] lg:grid-cols-2`}>
          <h2 id="fix" className={H2}>
            How QueueUp stops it
          </h2>
          <div className="space-y-[var(--m)] text-lg leading-relaxed">
            <p>
              QueueUp makes the check and the sale a single step that only one buyer can take at a time for a given
              seat. Everyone else waits a few milliseconds for their turn, then sees the real, updated count.
            </p>
            <p>
              So the second buyer never sees a seat that&apos;s already gone. They&apos;re told it&apos;s sold out,
              straight away, instead of being charged for a seat that doesn&apos;t exist. The database itself also
              refuses to record more tickets than seats, as a last line of defence.
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- the race */}
      <section className={`${WRAP} board-section`} aria-labelledby="race">
        <h2 id="race" className={`max-w-3xl ${H2}`}>
          A hundred buyers, one seat, replayed
        </h2>
        <p className={`mt-[var(--m)] ${PROSE}`}>
          This board replays QueueUp&apos;s own test: 100 buyers try to reserve the last seat at the same instant.
        </p>
        <div className="mt-[calc(var(--m)*2)] grid items-start gap-[calc(var(--m)*2)] lg:grid-cols-[1fr_1fr]">
          <div>
            <RaceBoard />
            <p className="mt-[calc(var(--m)/2)] text-xs leading-relaxed text-board-muted">
              An illustration of{" "}
              <code className="font-mono text-[11px] text-board-text">test_100_buyers_race_for_the_last_seat</code>,
              which runs against a real database on every change. Not live traffic.
            </p>
          </div>
          <div>
            <h3 className="font-display text-2xl font-extrabold uppercase tracking-[0.02em]">How to read it</h3>
            <ul className="mt-[var(--m)] divide-y divide-board-rule border-y border-board-rule">
              {KEY.map((k, i) => (
                <li key={i} className="flex items-start gap-[calc(var(--m)*0.75)] py-[calc(var(--m)*0.75)]">
                  <span className="mt-0.5 flex w-9 shrink-0 justify-center">{k.mark}</span>
                  <span className="leading-relaxed text-board-text/90">{k.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <SlotRule />

      {/* ------------------------------------------------------- every race */}
      <section className={`${WRAP} board-section`} aria-labelledby="races">
        <h2 id="races" className={`max-w-3xl ${H2}`}>
          It&apos;s not just the last seat
        </h2>
        <p className={`mt-[var(--m)] ${PROSE}`}>
          The same one-at-a-time rule settles every moment where two things could happen at once: a payment arriving as
          a hold runs out, a ticket scanned at two doors, a double-clicked button. Each has exactly one winner, and the
          other side gets a clear answer.
        </p>
        <div className="mt-[calc(var(--m)*2)]">
          <LineScore />
        </div>
        <p className="mt-[var(--m)] flex items-center gap-2 text-sm text-board-muted">
          <Lit /> wins <span aria-hidden>·</span> <Out /> gets the answer on the right. Every row is a test that runs on
          every change.
        </p>
      </section>

      {/* ------------------------------------------------------ under the hood */}
      <section className="bg-board-deep" aria-labelledby="hood">
        <div className={`${WRAP} board-section grid gap-[calc(var(--m)*2)] lg:grid-cols-[1fr_1fr]`}>
          <div>
            <h2 id="hood" className={H2}>
              Under the hood
            </h2>
            <p className={`mt-[var(--m)] ${PROSE}`}>
              A Next.js site talks to a Python API. PostgreSQL row locks and guarded updates do the one-at-a-time work,
              Redis carries live seat counts to every open page, and a background worker returns abandoned seats to sale.
            </p>
          </div>
          <ul className="self-end divide-y divide-board-rule border-y border-board-rule">
            {[
              { href: REPO, label: "Source code on GitHub" },
              { href: `${REPO}/blob/main/api/tests/test_concurrency.py`, label: "The concurrency tests" },
              { href: `${PUBLIC_API_URL}/docs`, label: "API reference" },
            ].map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="flex w-full items-center justify-between py-[calc(var(--m)*0.75)] font-display text-base font-bold uppercase tracking-[0.1em] text-board-text hover:text-bulb"
                >
                  {l.label} <ArrowIcon className="h-4 w-4" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`${WRAP} board-section flex flex-wrap items-center justify-between gap-[var(--m)]`}>
        <p className="font-stencil text-[clamp(2rem,4vw,3rem)] font-extrabold uppercase leading-none">
          Ready to try it?
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/organizer/new" className={`${PLATE_BTN} min-w-[calc(var(--m)*9)]`}>
            Host an event <ArrowIcon className="h-5 w-5 shrink-0" />
          </Link>
          <Link href="/events" className={`${PLATE_BTN} min-w-[calc(var(--m)*9)]`}>
            Find an event <ArrowIcon className="h-5 w-5 shrink-0" />
          </Link>
        </div>
      </section>

      <SlotRule />
      <SiteFooter />
    </div>
  );
}
