/* One stroke family for the whole product: 24px grid, 2.5 stroke, square caps —
   the weight of hand-painted scoreboard glyphs. */

type IconProps = { className?: string; title?: string };

function Svg({ className, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12.5l5 5L20 6.5" />
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v10M12 19v1" />
  </Svg>
);

export const CrossIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />
  </Svg>
);

export const ArrowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </Svg>
);

export const ReplayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" />
  </Svg>
);
