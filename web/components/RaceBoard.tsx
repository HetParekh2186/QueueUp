"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowIcon, ReplayIcon } from "./icons";

const N = 100;
const ARRIVE_MS = 1100; // all 100 requests land within ~1s
const LOCK_AT = 1350; // the first arrival holds the row lock and commits
const DRAIN_MS = 900; // the 99 queued behind it each read sold=1 and back out
const END = LOCK_AT + DRAIN_MS + 120;

type Race = { arrival: number[]; order: number[]; winner: number };

function newRace(): Race {
  const arrival = Array.from({ length: N }, () => Math.random() ** 1.6 * ARRIVE_MS);
  const order = arrival.map((_, i) => i).sort((a, b) => arrival[a] - arrival[b]);
  // Exactly like Postgres: whoever reaches SELECT … FOR UPDATE first wins.
  return { arrival, order, winner: order[0] };
}

// Matrix spacing comes from the page module so plates and bulbs share one pitch.
const MATRIX_GAP = "gap-[calc(var(--m)/3)]";
const MATRIX_PAD = "px-[calc(var(--m)*0.75)]";

function Plate({
  label,
  short,
  value,
  tone,
  start,
}: {
  label: string;
  short?: string;
  value: number;
  tone?: "bulb" | "out";
  start: string;
}) {
  return (
    <div className={`col-span-2 flex flex-col items-center gap-1.5 ${start}`}>
      <span
        className={`whitespace-nowrap font-display text-[11px] font-bold uppercase tracking-[0.14em] sm:text-xs ${
          tone === "bulb" ? "text-bulb" : tone === "out" ? "text-board-text" : "text-board-muted"
        }`}
      >
        {tone === "out" && <span className="mr-1 inline-block h-2 w-2 rounded-full outline outline-[1.5px] outline-dashed outline-out" aria-hidden />}
        {short ? (
          <>
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
      <span key={value} className="plate-num plate-flip block min-w-[2.6ch] px-1.5 py-1 text-center text-3xl sm:text-4xl">
        {value}
      </span>
    </div>
  );
}

export function RaceBoard() {
  const [race, setRace] = useState<Race>(() => ({ arrival: Array(N).fill(0), order: [], winner: -1 }));
  const [t, setT] = useState(-1);
  const raf = useRef(0);
  const root = useRef<HTMLElement>(null);

  const run = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const next = newRace();
    setRace(next);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setT(END);
      return;
    }
    const start = performance.now() + 250;
    const tick = (now: number) => {
      const e = now - start;
      setT(e);
      if (e < END) raf.current = requestAnimationFrame(tick);
    };
    setT(-1);
    raf.current = requestAnimationFrame(tick);
  }, []);

  // First run waits until the board is actually on screen, so phone visitors
  // (who scroll past the headline first) see the race happen, not its result.
  useEffect(() => {
    const el = root.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !el || !("IntersectionObserver" in window)) {
      run();
      return () => cancelAnimationFrame(raf.current);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          run();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [run]);

  const { states, requests, seats, inCount, outCount } = useMemo(() => {
    const rank = new Map(race.order.map((idx, r) => [idx, r]));
    let requests = 0;
    let outCount = 0;
    const states = race.arrival.map((a, i) => {
      if (race.winner < 0 || t < a) return "off";
      requests++;
      if (i === race.winner) return t >= LOCK_AT ? "won" : "lit";
      // Losers resolve in lock-queue order, each after the winner commits.
      const outAt = LOCK_AT + ((rank.get(i) ?? 0) / (N - 1)) * DRAIN_MS;
      if (t >= outAt) {
        outCount++;
        return "out";
      }
      return "lit";
    });
    const committed = race.winner >= 0 && t >= LOCK_AT;
    return { states, requests, seats: committed ? 0 : 1, inCount: committed ? 1 : 0, outCount };
  }, [race, t]);

  const done = t >= END;

  return (
    <figure ref={root} className="flex flex-col gap-[calc(var(--m)*0.75)]">
      <div className={`grid grid-cols-10 ${MATRIX_GAP} ${MATRIX_PAD}`}>
        <Plate label="Seats left" short="Seats" value={seats} start="col-start-1" />
        <Plate label="Requests" short="Buyers" value={requests} start="col-start-3" />
        {/* the race: requests on the left resolve into outcomes on the right */}
        <ArrowIcon className="col-span-2 col-start-5 h-6 w-6 self-end justify-self-center pb-2 text-board-muted sm:h-7 sm:w-7" />
        <Plate label="In" value={inCount} tone="bulb" start="col-start-7" />
        <Plate label="Out" value={outCount} tone="out" start="col-start-9" />
      </div>

      <div
        className={`grid grid-cols-10 ${MATRIX_GAP} ${MATRIX_PAD} rounded-[4px] bg-board-deep py-[calc(var(--m)*0.75)]`}
        aria-hidden
      >
        {states.map((s, i) => (
          <span key={i} className="bulb" data-state={s} />
        ))}
      </div>

      <figcaption className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-display text-sm font-bold uppercase tracking-[0.12em] text-board-muted" aria-live="polite">
          {done ? (
            <>
              <span className="text-bulb">Final</span> · 1 reserved · 99 sold out · 0 oversold
            </>
          ) : t >= LOCK_AT ? (
            "Lock taken · the queue reads sold out"
          ) : (
            "100 buyers · 1 seat · same instant"
          )}
        </span>
        <button
          type="button"
          onClick={run}
          disabled={!done}
          className="inline-flex items-center gap-1.5 rounded-[3px] border border-board-rule px-3 py-1.5 font-display text-sm font-bold uppercase tracking-[0.1em] text-board-text transition-colors hover:border-bulb hover:text-bulb disabled:opacity-40"
        >
          <ReplayIcon className="h-4 w-4" />
          Run it again
        </button>
      </figcaption>
    </figure>
  );
}
