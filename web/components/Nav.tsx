"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-stencil font-extrabold uppercase tracking-[0.08em] ${className}`}>
      <span className="h-2.5 w-2.5 rounded-full bg-bulb" aria-hidden />
      QueueUp
    </span>
  );
}

export function Nav() {
  const { user, ready, logout } = useAuth();
  const path = usePathname();
  const router = useRouter();

  const link = (href: string, label: string) => {
    const active = path === href || path.startsWith(href + "/");
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex h-full items-center border-b-2 px-2.5 font-display text-[15px] font-bold uppercase tracking-[0.08em] transition-colors ${
          active ? "border-bulb text-board-text" : "border-transparent text-board-muted hover:text-board-text"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-20 bg-board text-board-text">
      <nav className="mx-auto flex h-14 max-w-6xl items-stretch gap-1 px-4">
        <Link href="/" className="mr-4 flex items-center text-xl" aria-label="QueueUp home">
          <Wordmark />
        </Link>
        {link("/events", "Events")}
        {user && link("/tickets", "My tickets")}
        {user && link("/organizer", "Organize")}
        <div className="ml-auto flex items-center gap-3">
          {ready && !user && (
            <>
              <Link
                href="/login"
                className="font-display text-[15px] font-bold uppercase tracking-[0.08em] text-board-muted hover:text-board-text"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-[3px] bg-plate px-3 py-1.5 font-display text-[15px] font-bold uppercase tracking-[0.08em] text-plate-ink hover:bg-bulb"
              >
                Sign up
              </Link>
            </>
          )}
          {user && (
            <>
              <span className="hidden text-sm text-board-muted sm:inline">{user.display_name}</span>
              <button
                className="rounded-[3px] border border-board-rule px-3 py-1.5 font-display text-[15px] font-bold uppercase tracking-[0.08em] text-board-text hover:border-board-text"
                onClick={() => {
                  logout();
                  router.push("/");
                }}
              >
                Log out
              </button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
