"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertIcon, CheckIcon, EyeIcon, EyeOffIcon } from "@/components/icons";
import { ErrorBanner } from "@/components/ui";
import { PUBLIC_API_URL, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Mode = "login" | "signup";

// Seeded demonstration accounts (see `python -m app.seed`). Offered only when the
// API reports demo data exists, so the buttons never lead to a failed login.
const DEMO_PASSWORD = "queueup-demo";
const DEMOS = [
  { label: "Attendee", detail: "tickets and QR codes", email: "priya.abbott0@demo.queueup.app" },
  { label: "Organizer", detail: "dashboards and events", email: "organizer@demo.queueup.app" },
  { label: "Door staff", detail: "the scanner", email: "staff1@demo.queueup.app" },
];

const COPY = {
  login: {
    title: "Back through the gate.",
    lede: "Your tickets, QR codes and door shifts are waiting.",
    submit: "Log in",
  },
  signup: {
    title: "Get on the board.",
    lede: "One free account to buy tickets, host events and work the door.",
    submit: "Create account",
  },
} as const;

const STEPS = [
  { n: 1, word: "Reserve", line: "Your seat is held for 10 minutes." },
  { n: 2, word: "Pay", line: "Inside the window, with a test card." },
  { n: 3, word: "Walk in", line: "Show your QR code at the door." },
];

export function AuthForm({ mode }: { mode: Mode }) {
  const { login, signup } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // which action is running
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Errors show only after the first submit attempt, then update live as you type.
  const [attempted, setAttempted] = useState(false);
  const [demoAvailable, setDemoAvailable] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  // Only follow same-site relative redirects (no open redirect via ?next=https://evil).
  const nextParam = params.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const nextQs = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  const copy = COPY[mode];

  useEffect(() => {
    firstField.current?.focus();
    fetch(`${PUBLIC_API_URL}/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setDemoAvailable(Boolean(s?.includes_demo)))
      .catch(() => setDemoAvailable(false));
  }, []);

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setError(null);
    try {
      await fn();
      router.push(next);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  const longEnough = password.length >= 8;
  const fieldErrors = validate(mode, name, email, password);
  const shown: FieldErrors = attempted ? fieldErrors : {};

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAttempted(true);
    const first = (["name", "email", "password"] as const).find((f) => fieldErrors[f]);
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    run("submit", () =>
      mode === "login" ? login(email.trim(), password) : signup(email.trim(), password, name.trim()),
    );
  }

  const bad = (f: keyof FieldErrors) => (shown[f] ? "!border-bad focus:!border-bad focus-visible:!outline-bad" : "");

  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-[4px] border border-line lg:min-h-[36rem] lg:grid-cols-[1fr_1.05fr]">
      {/* ------------------------------------------------ the board side */}
      <aside className="flex flex-col bg-board px-6 py-7 text-board-text sm:px-10 sm:py-10">
        <h1 className="font-stencil text-[clamp(2.5rem,5vw,4rem)] font-extrabold uppercase leading-[0.9]">
          {copy.title.split(" ").slice(0, -1).join(" ")}{" "}
          <span className="text-bulb">{copy.title.split(" ").slice(-1)}</span>
        </h1>
        <p className="mt-4 max-w-sm text-board-text/85">{copy.lede}</p>

        {mode === "signup" && (
          <ol className="mt-8 hidden space-y-3 lg:mt-auto lg:block">
            {STEPS.map((s) => (
              <li key={s.n} className="flex items-center gap-4">
                <span className="plate-num grid h-11 w-10 shrink-0 place-items-center text-2xl">{s.n}</span>
                <span>
                  <span className="block font-display text-lg font-extrabold uppercase leading-none tracking-[0.04em]">
                    {s.word}
                  </span>
                  <span className="text-sm text-board-text/75">{s.line}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        {mode === "login" && (
          <div className="mt-8 hidden items-center gap-4 border-t border-board-rule pt-6 lg:mt-auto lg:flex">
            <span className="plate-num grid h-14 w-12 shrink-0 place-items-center text-3xl">1</span>
            <p className="text-sm text-board-text/80">
              Every seat is sold exactly once.{" "}
              <Link href="/about" className="text-board-text underline decoration-bulb decoration-2 underline-offset-4 hover:text-bulb">
                How it works
              </Link>
            </p>
          </div>
        )}
      </aside>

      {/* ------------------------------------------------- the form side */}
      <section className="bg-card px-6 py-8 sm:px-10 sm:py-10">
        <nav aria-label="Account" className="inline-flex rounded-[3px] border border-line p-0.5">
          {(["login", "signup"] as const).map((m) => (
            <Link
              key={m}
              href={`/${m}${nextQs}`}
              replace
              aria-current={m === mode ? "page" : undefined}
              className={`rounded-[2px] px-4 py-1.5 font-display text-sm font-bold uppercase tracking-[0.08em] transition-colors ${
                m === mode ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
              }`}
            >
              {m === "login" ? "Log in" : "Sign up"}
            </Link>
          ))}
        </nav>

        {/* noValidate: the browser's own bubbles can't be styled, so errors are drawn here instead. */}
        <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
          {mode === "signup" && (
            <Field label="Your name" htmlFor="name" error={shown.name}>
              <input
                ref={firstField}
                id="name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={shown.name ? true : undefined}
                aria-describedby={shown.name ? "name-error" : undefined}
                className={`input h-12 !bg-paper !text-base ${bad("name")}`}
                required
                maxLength={80}
                autoComplete="name"
                placeholder="Jordan Lee"
              />
            </Field>
          )}
          <Field label="Email" htmlFor="email" error={shown.email}>
            <input
              ref={mode === "login" ? firstField : undefined}
              id="email"
              name="email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={shown.email ? true : undefined}
              aria-describedby={shown.email ? "email-error" : undefined}
              className={`input h-12 !bg-paper !text-base ${bad("email")}`}
              required
              autoComplete={mode === "login" ? "username" : "email"}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password" htmlFor="password" error={mode === "login" ? shown.password : undefined}>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                className={`input h-12 !bg-paper !pr-12 !text-base ${bad("password")}`}
                aria-invalid={shown.password ? true : undefined}
                required
                minLength={mode === "signup" ? 8 : undefined}
                maxLength={128}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                onBlur={() => setCapsLock(false)}
                aria-describedby={mode === "login" && shown.password ? "password-error password-help" : "password-help"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 grid w-12 place-items-center text-muted hover:text-ink"
              >
                {showPassword ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
            <div id="password-help" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-live="polite">
              {mode === "signup" && (
                <span
                  className={`inline-flex items-center gap-1.5 ${
                    longEnough ? "text-ok" : shown.password ? "font-semibold text-bad" : "text-muted"
                  }`}
                >
                  {longEnough ? (
                    <CheckIcon className="h-3.5 w-3.5" />
                  ) : shown.password ? (
                    <AlertIcon className="h-3.5 w-3.5" />
                  ) : (
                    <span className="h-2 w-2 rounded-full outline outline-[1.5px] outline-current" aria-hidden />
                  )}
                  At least 8 characters
                </span>
              )}
              {capsLock && <span className="font-semibold text-warn">Caps Lock is on</span>}
            </div>
          </Field>

          <div aria-live="assertive">
            <ErrorBanner message={error} />
          </div>

          <button className="btn-primary h-12 w-full !text-lg" disabled={busy !== null}>
            {busy === "submit" ? "One moment…" : copy.submit}
          </button>
          {mode === "signup" && (
            <p className="text-center text-xs text-muted">Free. Payments on QueueUp use simulated test cards.</p>
          )}
        </form>

        {demoAvailable && (
          <div className="mt-10 border-t border-line pt-6">
            <h2 className="label">Just looking around?</h2>
            <p className="text-sm text-muted">Log straight in to a demo account. Nothing here is real money.</p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-3">
              {DEMOS.map((d) => (
                <li key={d.email}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => run(d.email, () => login(d.email, DEMO_PASSWORD))}
                    className="group flex h-full w-full flex-col items-start rounded-[3px] border border-line px-3 py-2.5 text-left transition-colors hover:border-ink disabled:opacity-50"
                  >
                    <span className="font-display text-base font-extrabold uppercase tracking-[0.06em]">
                      {busy === d.email ? "Opening…" : d.label}
                    </span>
                    <span className="text-xs text-muted">{d.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

type FieldErrors = { name?: string; email?: string; password?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Plain-language messages that say what to do, not just what went wrong. */
function validate(mode: Mode, name: string, email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (mode === "signup" && !name.trim()) errors.name = "Add your name. It's shown on your tickets at the door.";
  if (!email.trim()) errors.email = "Enter your email address.";
  else if (!EMAIL.test(email.trim())) errors.email = "That doesn't look like an email address. Try one like you@example.com.";
  if (mode === "signup" && password.length < 8) errors.password = "Use at least 8 characters.";
  if (mode === "login" && !password) errors.password = "Enter your password.";
  return errors;
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={`label ${error ? "!text-bad" : ""}`} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} className="mt-2 flex items-start gap-1.5 text-sm font-medium text-bad" role="alert">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
