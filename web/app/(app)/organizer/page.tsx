"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorBanner, RequireAuth, StatusPill } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { eventTime } from "@/lib/format";
import type { EventSummary } from "@/lib/types";

export default function OrganizerPage() {
  return (
    <RequireAuth>
      <Organizer />
    </RequireAuth>
  );
}

function EventRow({ e, href, action }: { e: EventSummary; href: string; action?: React.ReactNode }) {
  const claimed = e.capacity - e.remaining;
  return (
    <li className="card flex flex-wrap items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={href} className="truncate font-display text-lg font-semibold hover:text-accent">
            {e.title}
          </Link>
          <StatusPill status={e.status} />
        </div>
        <p className="text-sm text-muted">{eventTime(e.starts_at, e.timezone)}</p>
      </div>
      <div className="w-40">
        <div className="mb-1 flex justify-between font-mono text-xs text-muted">
          <span>{claimed} claimed</span>
          <span>{e.capacity}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded bg-line">
          <div className="h-full bg-accent" style={{ width: `${e.capacity ? (claimed / e.capacity) * 100 : 0}%` }} />
        </div>
      </div>
      {action}
    </li>
  );
}

function Organizer() {
  const [mine, setMine] = useState<EventSummary[] | null>(null);
  const [staffing, setStaffing] = useState<EventSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<EventSummary[]>("/me/events"), api<EventSummary[]>("/me/staff-events")])
      .then(([m, s]) => {
        setMine(m);
        setStaffing(s);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Organize</h1>
          <p className="text-muted">Events you host, and doors you&apos;re working.</p>
        </div>
        <Link href="/organizer/new" className="btn-primary">
          New event
        </Link>
      </div>
      <div className="mt-4">
        <ErrorBanner message={error} />
      </div>

      <section className="mt-8">
        <h2 className="label">Your events</h2>
        {mine?.length === 0 && (
          <p className="card p-6 text-muted">
            You haven&apos;t created an event yet. Create one, add ticket types, then publish it.
          </p>
        )}
        <ul className="space-y-2">
          {mine?.map((e) => <EventRow key={e.id} e={e} href={`/organizer/events/${e.id}`} />)}
        </ul>
      </section>

      {staffing.length > 0 && (
        <section className="mt-10">
          <h2 className="label">Door staff assignments</h2>
          <ul className="space-y-2">
            {staffing.map((e) => (
              <EventRow
                key={e.id}
                e={e}
                href={`/events/${e.id}`}
                action={
                  <Link href={`/scan/${e.id}`} className="btn-primary !py-1.5">
                    Scan tickets
                  </Link>
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
