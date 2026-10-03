"use client";

/* Filter controls in the board's plate language: square plates, stenciled caps.
   The active choice is the accent plate (green by day, enamel at night). Amber stays
   reserved for "lit / live". */

const PLATE =
  "font-display text-[13px] font-bold uppercase tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[3px] border border-line bg-card p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`${PLATE} rounded-[2px] px-3 py-1.5 ${
              active ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
            {o.count !== undefined && <span className="ml-1.5 tabular opacity-75">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`${PLATE} inline-flex items-center gap-2 rounded-[3px] border px-3 py-[7px] ${
        checked ? "border-accent bg-accent text-accent-ink" : "border-line bg-card text-muted hover:text-ink"
      }`}
    >
      <span
        aria-hidden
        className={`h-2.5 w-2.5 rounded-full ${checked ? "bg-accent-ink" : "outline outline-[1.5px] -outline-offset-[1.5px] outline-current"}`}
      />
      {label}
    </button>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative min-w-0 basis-full sm:max-w-xs sm:flex-1 sm:basis-auto">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="square"
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
      >
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="M15 15l5 5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={100}
        className="input !pl-9"
      />
    </div>
  );
}
