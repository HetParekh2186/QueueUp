"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner, RequireAuth } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { EventDetail } from "@/lib/types";

export default function NewEventPage() {
  return (
    <RequireAuth>
      <NewEvent />
    </RequireAuth>
  );
}

const ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

function NewEvent() {
  const router = useRouter();
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = ZONES.includes(browserZone) ? ZONES : [browserZone, ...ZONES];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const event = await api<EventDetail>("/events", {
        method: "POST",
        body: {
          title: f.get("title"),
          description: f.get("description") || null,
          venue: f.get("venue") || null,
          starts_at_local: f.get("starts_at"),
          ends_at_local: f.get("ends_at") || null,
          timezone: f.get("timezone"),
        },
      });
      await api(`/events/${event.id}/ticket-types`, {
        method: "POST",
        body: {
          name: f.get("tier_name"),
          price_cents: Math.round(Number(f.get("tier_price")) * 100),
          capacity: Number(f.get("tier_capacity")),
        },
      });
      router.push(`/organizer/events/${event.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-4xl font-bold tracking-tight">New event</h1>
      <p className="text-muted">It starts as a draft. Nobody can see it until you publish.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-8">
        <fieldset className="space-y-4">
          <div>
            <label className="label" htmlFor="title">
              Title
            </label>
            <input id="title" name="title" className="input" required maxLength={200} />
          </div>
          <div>
            <label className="label" htmlFor="venue">
              Venue
            </label>
            <input id="venue" name="venue" className="input" maxLength={300} />
          </div>
          <div>
            <label className="label" htmlFor="description">
              Description
            </label>
            <textarea id="description" name="description" className="input min-h-28" maxLength={5000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="starts_at">
                Starts (venue time)
              </label>
              <input id="starts_at" name="starts_at" type="datetime-local" className="input" required />
            </div>
            <div>
              <label className="label" htmlFor="ends_at">
                Ends (optional)
              </label>
              <input id="ends_at" name="ends_at" type="datetime-local" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="timezone">
                Venue time zone
              </label>
              <select id="timezone" name="timezone" className="input" defaultValue={browserZone}>
                {zones.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 font-display font-semibold">First ticket type</legend>
          <p className="text-sm text-muted">You can add more tiers (VIP, Student…) on the next screen.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="tier_name">
                Name
              </label>
              <input id="tier_name" name="tier_name" className="input" defaultValue="General" required maxLength={60} />
            </div>
            <div>
              <label className="label" htmlFor="tier_price">
                Price (USD)
              </label>
              <input id="tier_price" name="tier_price" type="number" min="0" step="0.01" className="input" defaultValue="25" required />
            </div>
            <div>
              <label className="label" htmlFor="tier_capacity">
                Capacity
              </label>
              <input id="tier_capacity" name="tier_capacity" type="number" min="0" max="100000" className="input" defaultValue="100" required />
            </div>
          </div>
        </fieldset>

        <ErrorBanner message={error} />
        <button className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create draft"}
        </button>
      </form>
    </div>
  );
}
