"use client";

import jsQR from "jsqr";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertIcon, CheckIcon, CrossIcon } from "@/components/icons";
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
  at: number;
};

const REASONS: Record<string, string> = {
  signature: "Not a QueueUp ticket. The code is invalid.",
  wrong_event: "This ticket is for a different event.",
  not_paid: "Not paid for. The hold was never completed.",
  cancelled: "This ticket was cancelled or refunded.",
  unknown_ticket: "Ticket not found.",
};

function toVerdict(status: number, body: Record<string, unknown>): Verdict {
  const at = Date.now();
  if (status === 200) return { tone: "ok", title: "Admitted", detail: `${body.attendee} · ${body.ticket_type}`, at };
  if (body.result === "already_used")
    return {
      tone: "warn",
      title: "Already in",
      detail: `${body.attendee} · scanned at ${clock(String(body.checked_in_at))}${body.checked_in_by ? ` by ${body.checked_in_by}` : ""}`,
      at,
    };
  if (status === 403) return { tone: "bad", title: "Not authorized", detail: "You're not assigned to this event.", at };
  return { tone: "bad", title: "Rejected", detail: REASONS[String(body.reason)] ?? "Not a valid ticket.", at };
}

/* Verdicts in the board's own language: lit amber for in, enamel for a repeat, and
   the dashed out-red ring for a rejection. Icon + word + colour, never colour alone. */
const VERDICT_STYLE = {
  ok: { panel: "bg-bulb text-plate-ink", icon: CheckIcon, iconTone: "" },
  warn: { panel: "bg-plate text-plate-ink", icon: AlertIcon, iconTone: "" },
  bad: {
    panel: "bg-board-deep text-board-text outline outline-[6px] -outline-offset-[14px] outline-dashed outline-out",
    icon: CrossIcon,
    iconTone: "text-out",
  },
} as const;

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
  const [history, setHistory] = useState<Verdict[]>([]);
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

  const inFlight = useRef(false);
  const submit = useCallback(
    async (qr: string, manual = false) => {
      // Camera reads see the same code on every frame, so they get a cooldown and a
      // same-code window. A typed code is a deliberate action: it only waits for a
      // request already in flight, never silently does nothing.
      const now = Date.now();
      if (inFlight.current) return;
      if (!manual && (busy.current || (qr === lastCode.current.code && now - lastCode.current.at < 4000))) return;
      inFlight.current = true;
      busy.current = true;
      lastCode.current = { code: qr, at: now };
      try {
        const body = await api<Record<string, unknown>>("/checkins", { method: "POST", body: { qr, event_id: eventId } });
        const v = toVerdict(200, body);
        setVerdict(v);
        setHistory((h) => [v, ...h].slice(0, 4));
        navigator.vibrate?.(80);
      } catch (err) {
        const v =
          err instanceof ApiError
            ? toVerdict(err.status, err.body)
            : { tone: "bad" as const, title: "No connection", detail: "Couldn't reach the server. Try again.", at: Date.now() };
        setVerdict(v);
        setHistory((h) => [v, ...h].slice(0, 4));
        navigator.vibrate?.([60, 60, 60]);
      } finally {
        inFlight.current = false;
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

  const style = verdict ? VERDICT_STYLE[verdict.tone] : null;
  const Icon = style?.icon;

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="label !mb-1">Door scanner</div>
          <Link href={`/events/${eventId}`} className="block truncate font-display text-xl font-bold hover:text-accent">
            {event?.title ?? "Loading event…"}
          </Link>
          <LiveDot on={live} />
        </div>
        {counts && (
          <div className="flex shrink-0 flex-col items-end">
            <span className="plate-num px-2.5 py-1 text-3xl">{counts.in}</span>
            <span className="mt-1 font-display text-xs font-bold uppercase tracking-[0.12em] text-muted">
              in{counts.total ? ` of ${counts.total}` : ""}
            </span>
          </div>
        )}
      </div>

      <div className="relative aspect-square overflow-hidden rounded-[4px] bg-board-deep">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
        {camera === "on" && !verdict && (
          // Aim guide: four drawn corner brackets, lit amber while the camera is live.
          <svg className="pointer-events-none absolute inset-[16%] h-[68%] w-[68%] text-bulb" viewBox="0 0 100 100" aria-hidden>
            <path
              d="M2 22V2h20M78 2h20v20M98 78v20H78M22 98H2V78"
              fill="none"
              stroke="currentColor"
              strokeWidth={4}
              strokeLinecap="square"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        {camera !== "on" && (
          <div className="absolute inset-0 grid place-items-center p-8 text-center">
            <p className="text-board-text/85">
              {camera === "starting"
                ? "Starting the camera…"
                : "No camera. Allow camera access, or open this page over HTTPS. You can paste a ticket code below."}
            </p>
          </div>
        )}
        {verdict && style && Icon && (
          <button
            className={`absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center ${style.panel}`}
            onClick={() => setVerdict(null)}
            role="alert"
          >
            <Icon className={`h-20 w-20 ${style.iconTone}`} />
            <span className="font-stencil text-5xl font-extrabold uppercase leading-none">{verdict.title}</span>
            {verdict.detail && <span className="max-w-[24ch] text-lg font-medium">{verdict.detail}</span>}
            <span className="mt-4 font-display text-sm font-bold uppercase tracking-[0.12em] opacity-70">Tap to scan next</span>
          </button>
        )}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            submit(manual.trim(), true);
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

      {history.length > 0 && (
        <section className="mt-6" aria-label="Last scans">
          <h2 className="label">Last scans</h2>
          <ul className="divide-y divide-line rounded-[4px] border border-line">
            {history.map((h) => {
              const HIcon = VERDICT_STYLE[h.tone].icon;
              return (
                <li key={h.at} className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                      h.tone === "ok"
                        ? "bg-bulb text-plate-ink"
                        : h.tone === "warn"
                          ? "bg-plate text-plate-ink"
                          : "text-out outline outline-[1.5px] -outline-offset-[1.5px] outline-dashed outline-out"
                    }`}
                  >
                    <HIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-sm font-bold uppercase tracking-[0.06em]">{h.title}</span>
                    {h.detail && <span className="block truncate text-xs text-muted">{h.detail}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{clock(new Date(h.at).toISOString())}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
