export function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  if (cents === 0) return "Free";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** Always render an event's time in the *venue's* zone: "8:00 PM CDT" means the same
 *  thing to a buyer in London as to one in Chicago. */
export function eventTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function eventDay(iso: string, timeZone: string): { month: string; day: string } {
  const d = new Date(iso);
  return {
    month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone }).format(d).toUpperCase(),
    day: new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone }).format(d),
  };
}

export function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(
    new Date(iso),
  );
}

/** Convert an ISO instant to the "YYYY-MM-DDTHH:mm" wall time in a zone, for <input type=datetime-local>. */
export function toLocalInput(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function uuid(): string {
  return crypto.randomUUID();
}
