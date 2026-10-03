"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useAuth } from "@/lib/auth";

export function QrImage({ value, size = 220 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: "M" }).then(setSrc);
  }, [value, size]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} alt="Ticket QR code" className="rounded bg-white p-1" />
  ) : (
    <div style={{ width: size, height: size }} className="animate-pulse rounded bg-line" />
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
      {message}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    published: "bg-ok/15 text-ok",
    confirmed: "bg-ok/15 text-ok",
    paid: "bg-ok/15 text-ok",
    checked_in: "bg-ink/10 text-ink",
    draft: "bg-warn/15 text-warn",
    held: "bg-warn/15 text-warn",
    pending: "bg-warn/15 text-warn",
    cancelled: "bg-bad/15 text-bad",
    expired: "bg-bad/15 text-bad",
    refunded: "bg-bad/15 text-bad",
    ended: "bg-ink/10 text-muted",
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${
        tone[status] ?? "bg-line text-muted"
      }`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

/** Wrap pages that need a logged-in user. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const path = usePathname();
  if (!ready) return <div className="py-24 text-center text-muted">Loading…</div>;
  if (!user) {
    const next = encodeURIComponent(path);
    return (
      <div className="mx-auto max-w-sm py-24 text-center">
        <p className="mb-5 text-muted">Log in or create a free account to continue.</p>
        <div className="flex justify-center gap-2">
          <Link href={`/signup?next=${next}`} className="btn-primary">
            Sign up
          </Link>
          <Link href={`/login?next=${next}`} className="btn-ghost">
            Log in
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`font-mono text-3xl font-semibold tabular ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function LiveDot({ on }: { on: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted">
      <span className={`h-2 w-2 rounded-full ${on ? "animate-pulse bg-ok" : "bg-line"}`} />
      {on ? "Live" : "Offline"}
    </span>
  );
}
