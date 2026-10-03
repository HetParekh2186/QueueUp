import { notFound } from "next/navigation";
import { serverApi } from "@/lib/api";
import type { EventDetail } from "@/lib/types";
import { EventView } from "./EventView";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Server-rendered for public, published events (fast first paint, shareable links).
  // Drafts 404 here; the client view refetches with the organizer's token.
  const event = await serverApi<EventDetail>(`/events/${id}`);
  if (event === null && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <EventView id={id} initial={event} />;
}
