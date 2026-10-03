"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBanner, RequireAuth } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canOrganize } from "@/lib/types";

/** Organizer-only pages. Plain users get a way to ask for access instead of a dead end. */
export function RequireOrganizer({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <Gate>{children}</Gate>
    </RequireAuth>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (canOrganize(user)) return <>{children}</>;
  return <BecomeOrganizer />;
}

function BecomeOrganizer() {
  const { user, refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = Boolean(user?.organizer_requested_at);

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      await api("/me/organizer-request", { method });
      await refreshUser();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl py-12">
      <h1 className="font-display text-4xl font-bold tracking-tight">Host events on QueueUp</h1>
      <p className="mt-3 leading-relaxed text-muted">
        Organizers create events, set ticket tiers and capacity, assign door staff and watch sales and check-ins live.
        Organizer access is approved by the QueueUp admin, so attendees only ever see real events.
      </p>

      <div className="card mt-8 p-6">
        {pending ? (
          <>
            <div className="label">Request sent</div>
            <p className="font-semibold">
              You asked for organizer access on{" "}
              {new Date(user!.organizer_requested_at!).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.
            </p>
            <p className="mt-1 text-sm text-muted">
              Once it&apos;s approved, the Organize tab appears in the menu. You don&apos;t need to log in again.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button className="btn-ghost" disabled={busy} onClick={() => refreshUser()}>
                Check again
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => send("DELETE")}>
                Withdraw request
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="label">Organizer access</div>
            <p className="font-semibold">Ask the admin to make you an organizer.</p>
            <p className="mt-1 text-sm text-muted">You can keep buying tickets and scanning doors in the meantime.</p>
            <button className="btn-primary mt-5" disabled={busy} onClick={() => send("POST")}>
              {busy ? "Sending…" : "Request organizer access"}
            </button>
          </>
        )}
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      </div>

      <p className="mt-6 text-sm text-muted">
        Assigned to work a door? Your shifts are in{" "}
        <Link href="/tickets" className="text-ink underline underline-offset-4">
          My tickets
        </Link>
        .
      </p>
    </div>
  );
}
