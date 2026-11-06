import type { ReactNode } from "react";

// Small two-tone illustrations for empty pages. Shapes use the empty-art-*
// classes so the theme colors live in the stylesheet.
const ART = {
  posts: (
    <>
      <rect
        className="empty-art-soft"
        x="14"
        y="18"
        width="78"
        height="52"
        rx="12"
      />
      <path className="empty-art-soft" d="M30 70l-4 16 18-16z" />
      <rect
        className="empty-art-line"
        x="28"
        y="34"
        width="44"
        height="6"
        rx="3"
      />
      <rect
        className="empty-art-line"
        x="28"
        y="48"
        width="30"
        height="6"
        rx="3"
      />
      <rect
        className="empty-art-warm"
        x="62"
        y="44"
        width="66"
        height="44"
        rx="12"
      />
      <path className="empty-art-warm" d="M112 88l4 14-16-14z" />
      <circle className="empty-art-dot" cx="82" cy="66" r="4" />
      <circle className="empty-art-dot" cx="95" cy="66" r="4" />
      <circle className="empty-art-dot" cx="108" cy="66" r="4" />
    </>
  ),
  threads: (
    <>
      <rect
        className="empty-art-soft"
        x="16"
        y="16"
        width="112"
        height="24"
        rx="12"
      />
      <rect
        className="empty-art-line"
        x="30"
        y="25"
        width="58"
        height="6"
        rx="3"
      />
      <rect
        className="empty-art-warm"
        x="16"
        y="48"
        width="96"
        height="24"
        rx="12"
      />
      <rect
        className="empty-art-dot"
        x="30"
        y="57"
        width="46"
        height="6"
        rx="3"
      />
      <rect
        className="empty-art-soft"
        x="16"
        y="80"
        width="80"
        height="24"
        rx="12"
      />
      <rect
        className="empty-art-line"
        x="30"
        y="89"
        width="34"
        height="6"
        rx="3"
      />
    </>
  ),
  sessions: (
    <>
      <rect
        className="empty-art-soft"
        x="12"
        y="16"
        width="76"
        height="84"
        rx="10"
      />
      <path
        className="empty-art-stroke"
        d="M34 44l-10 10 10 10M66 44l10 10-10 10M56 38l-12 32"
      />
      <rect
        className="empty-art-warm"
        x="72"
        y="36"
        width="60"
        height="64"
        rx="10"
      />
      <path
        className="empty-art-stroke dark"
        d="M84 82c8-18 14 6 22-10s10 2 14-6"
      />
    </>
  ),
  resources: (
    <>
      <path
        className="empty-art-soft"
        d="M16 34a8 8 0 0 1 8-8h28l10 10h50a8 8 0 0 1 8 8v52a8 8 0 0 1-8 8H24a8 8 0 0 1-8-8z"
      />
      <rect
        className="empty-art-warm"
        x="44"
        y="46"
        width="44"
        height="54"
        rx="6"
      />
      <rect
        className="empty-art-dot"
        x="52"
        y="58"
        width="28"
        height="5"
        rx="2.5"
      />
      <rect
        className="empty-art-dot"
        x="52"
        y="70"
        width="20"
        height="5"
        rx="2.5"
      />
      <rect
        className="empty-art-dot"
        x="52"
        y="82"
        width="24"
        height="5"
        rx="2.5"
      />
    </>
  ),
} as const;

export function EmptyState({
  art,
  title,
  children,
  action,
}: {
  art: keyof typeof ART;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <svg
        className="empty-art"
        viewBox="0 0 144 116"
        width="144"
        height="116"
        aria-hidden="true"
      >
        {ART[art]}
      </svg>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
