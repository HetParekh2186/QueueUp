export type Role = "user" | "organizer" | "admin";

export type User = {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  is_admin: boolean;
  organizer_requested_at: string | null;
};

export const canOrganize = (u: User | null | undefined) => u?.role === "organizer" || u?.role === "admin";

export type AdminUser = User & {
  is_suspended: boolean;
  created_at: string;
  events_organized: number;
  tickets_held: number;
};

export type AdminStats = {
  users: number;
  organizers: number;
  pending_requests: number;
  suspended: number;
  events_by_status: Record<"draft" | "published" | "ended" | "cancelled", number>;
  tickets_sold: number;
  checked_in: number;
  revenue_cents: number;
};

export type TokenResponse = { access_token: string; refresh_token: string; user: User };

export type TicketType = {
  id: string;
  name: string;
  price_cents: number;
  capacity: number;
  sold: number;
  remaining: number;
};

export type EventStatus = "draft" | "published" | "cancelled" | "ended";

export type EventSummary = {
  id: string;
  title: string;
  venue: string | null;
  starts_at: string;
  timezone: string;
  status: EventStatus;
  min_price_cents: number | null;
  remaining: number;
  capacity: number;
  is_demo: boolean;
};

export type EventDetail = {
  id: string;
  organizer_id: string;
  organizer_name: string;
  title: string;
  description: string | null;
  venue: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  status: EventStatus;
  ticket_types: TicketType[];
  can_manage: boolean;
  can_scan: boolean;
};

export type Ticket = {
  id: string;
  status: "held" | "confirmed" | "checked_in" | "cancelled" | "expired";
  qr: string | null;
  ticket_type: string;
  event_id: string;
  event_title: string;
  event_status: EventStatus;
  starts_at: string;
  timezone: string;
  venue: string | null;
  order_id: string;
  checked_in_at: string | null;
};

export type Order = {
  id: string;
  event_id: string;
  event_title: string;
  ticket_type_id: string;
  ticket_type: string;
  quantity: number;
  status: "pending" | "paid" | "expired" | "cancelled" | "refunded";
  total_cents: number;
  expires_at: string;
  server_now: string;
  tickets: Ticket[];
};

export type Dashboard = {
  event_id: string;
  status: EventStatus;
  capacity: number;
  held: number;
  confirmed: number;
  checked_in: number;
  remaining: number;
  revenue_cents: number;
  ticket_types: {
    id: string;
    name: string;
    price_cents: number;
    capacity: number;
    held: number;
    confirmed: number;
    checked_in: number;
    remaining: number;
  }[];
  recent_scans: {
    scanned_at: string;
    result: string;
    reason: string | null;
    attendee: string | null;
    staff: string;
  }[];
};

export type Staff = { user_id: string; email: string; display_name: string };

export type SocketMessage =
  | { type: "hello"; privileged: boolean }
  | { type: "seats"; ticket_type_id: string; capacity: number; sold: number; remaining: number }
  | { type: "checkin"; checked_in: number }
  | { type: "orders" }
  | { type: "event"; status: EventStatus };
