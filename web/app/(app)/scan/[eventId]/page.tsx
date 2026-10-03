"use client";

import jsQR from "jsqr";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveDot, RequireAuth } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clock } from "@/lib/format";
import type { Dashboard, EventDetail } from "@/lib/types";
import { useEventSocket } from "@/lib/useEventSocket";

export default function ScanPage() {
  return (
    <RequireAuth>
      <Scanner />
    </RequireAuth>
  );
}

type Verdict = {
  tone: "ok" | "warn" | "bad";
  title: string;
  detail?: string;
};

const REASONS: Record<string, string> = {
  signature: "Invalid code — not a QueueUp ticket",
  wrong_event: "Ticket is for a different event",
  not_paid: "Not a valid ticket — unpaid or expired hold",
  cancelled: "Ticket was cancelled or refunded",
  unknown_ticket: "Ticket not found",
};

function toVerdict(status: number, body: Record<string, unknown>): Verdict {
  if (status === 200) return { tone: "ok", title: "Admitted", detail: `${body.attendee} · ${body.ticket_type}` };
  if (body.result === "already_used")
    return {
      tone: "warn",
      title: "Already checked in",
      detail: `${body.attendee} · at ${clock(String(body.checked_in_at))}${body.checked_in_by ? ` by ${body.checked_in_by}` : ""}`,
    };
  if (status === 403) return { tone: "bad", title: "Not authorized", detail: "You're not assigned to this event." };
  return { tone: "bad", title: "Rejected", detail: REASONS[String(body.reason)] ?? "Not a valid ticket" };
}

function Scanner() {
  const { eventId } = useParams<{ eventId: string }>();
  const { token } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [counts, setCounts] = useState<{ in: number; total: number } | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [camera, setCamera] = useState<"starting" | "on" | "unavailable">("starting");
  const [manual, setManual] = useState("");
  const busy = useRef(false);
  const lastCode = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => {
    api<EventDetail>(`/events/${eventId}`).then(setEvent).catch(() => {});
    api<Dashboard>(`/events/${eventId}/dashboard`)
      .then((d) => setCounts({ in: d.checked_in, total: d.checked_in + d.confirmed }))
      .catch(() => {});
  }, [eventId]);

  useEffect(() => {
    if (!verdict) return;
    const t = setTimeout(() => setVerdict(null), 2500);
    return () => clearTimeout(t);
  }, [verdict]);

  const live = useEventSocket(
    eventId,
    (msg) => {
      if (msg.type === "checkin") setCounts((c) => c && { ...c, in: msg.checked_in });
    },
    token,
  );

  const submit = useCallback(
    async (qr: string) => {
      // Ignore the same code for a few seconds: the camera sees it on every frame.
      const now = Date.now();
      if (busy.current || (qr === lastCode.current.code && now - lastCode.current.at < 4000)) return;
      busy.current = true;
      lastCode.current = { code: qr, at: now };
      try {
        const body = await api<Record<string, unknown>>("/checkins", { method: "POST", body: { qr, event_id: eventId } });
        setVerdict(toVerdict(200, body));
        navigator.vibrate?.(80);
      } catch (err) {
        if (err instanceof ApiError) setVerdict(toVerdict(err.status, err.body));
        else setVerdict({ tone: "bad", title: "No connection", detail: "Couldn't reach the server. Try again." });
        navigator.vibrate?.([60, 60, 60]);
      } finally {
        setTimeout(() => {
          busy.current = false;
        }, 1200);
      }
    },
    [eventId],
  );

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera("unavailable"); // needs HTTPS (or localhost)
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        setCamera("unavailable");
        return;
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setCamera("on");

      const tick = () => {
        if (stopped) return;
        const canvas = canvasRef.current;
        if (canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
          const w = (canvas.width = Math.min(video.videoWidth, 640));
          const h = (canvas.height = Math.round((video.videoHeight / video.videoWidth) * w));
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(video, 0, 0, w, h);
          const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          if (code?.data) submit(code.data);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [submit]);

  const toneBg = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" } as const;

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex items-center justify-between">
        <div className="min-w-0">
          <Link href={`/events/${eventId}`} className="block truncate font-display text-lg font-semibold">
            {event?.title ?? "Door scanner"}
          </Link>
          <LiveDot on={live} />
        </div>
        {counts && (
          <div className="text-right">
            <div className="font-mono text-3xl font-semibold tabular">{counts.in}</div>
            <div className="text-xs text-muted">checked in{counts.total ? ` of ${counts.total}` : ""}</div>
          </div>
        )}
      </div>

      <div className="relative aspect-square overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
        {camera === "on" && !verdict && (
          <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
        )}
        {camera !== "on" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
            {camera === "starting"
              ? "Starting camera…"
              : "Camera unavailable. Allow camera access, or open this page over HTTPS. You can paste a code below."}
          </div>
        )}
        {verdict && (
          <button
            className={`absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white ${toneBg[verdict.tone]}`}
            onClick={() => setVerdict(null)}
            aria-live="assertive"
          >
            <span className="text-7xl leading-none" aria-hidden>
              {verdict.tone === "ok" ? "✓" : verdict.tone === "warn" ? "!" : "✕"}
            </span>
            <span className="mt-3 font-display text-3xl font-bold">{verdict.title}</span>
            {verdict.detail && <span className="mt-1 text-lg opacity-90">{verdict.detail}</span>}
            <span className="mt-6 text-sm opacity-75">Tap to scan next</span>
          </button>
        )}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            lastCode.current = { code: "", at: 0 };
            submit(manual.trim());
            setManual("");
          }
        }}
      >
        <input
          className="input font-mono text-xs"
          placeholder="Paste a ticket code"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          aria-label="Ticket code"
        />
        <button className="btn-ghost shrink-0">Check</button>
      </form>
    </div>
  );
}
