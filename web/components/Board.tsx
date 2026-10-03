import Link from "next/link";
import { Wordmark } from "@/components/Nav";
import { PUBLIC_API_URL } from "@/lib/api";

/* Spacing in board modules (--m, the slot pitch). */
export const WRAP = "mx-auto max-w-6xl px-[calc(var(--m)*0.75)] sm:px-[var(--m)]";
export const H2 = "font-stencil text-[clamp(2.2rem,4.6vw,3.75rem)] font-extrabold uppercase leading-[0.92] [text-wrap:balance]";
export const PLATE_BTN =
  "group flex items-center justify-between gap-2 rounded-[3px] bg-plate px-4 py-3.5 font-display text-lg font-extrabold uppercase tracking-[0.06em] text-plate-ink transition-colors hover:bg-white";
export const BOARD_LINK =
  "inline-flex items-center gap-1.5 font-display text-base font-bold uppercase tracking-[0.1em] text-board-text underline decoration-bulb decoration-2 underline-offset-[6px] hover:text-bulb";

export function SlotRule() {
  return <div className={`slot-rule ${WRAP}`} aria-hidden />;
}

export function SiteFooter() {
  return (
    <footer>
      <div className={`${WRAP} flex flex-wrap items-center justify-between gap-[var(--m)] py-[calc(var(--m)*1.5)] text-sm text-board-text/75`}>
        <Wordmark className="text-lg text-board-text" />
        <p>A portfolio project. Payments use simulated test cards, and no real money moves.</p>
        <nav className="flex gap-5 font-display text-sm font-bold uppercase tracking-[0.1em]">
          <Link href="/events" className="hover:text-bulb">
            Events
          </Link>
          <Link href="/about" className="hover:text-bulb">
            How it works
          </Link>
          <a href={`${PUBLIC_API_URL}/docs`} className="hover:text-bulb">
            API docs
          </a>
        </nav>
      </div>
    </footer>
  );
}
