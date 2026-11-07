// Loading placeholders. Each one names what is loading for assistive
// technology and fades in only after a short delay (see .loading-line and
// .skeleton in styles.css), so fast loads go straight to the content.

const FEED_TITLES = ["72%", "58%", "80%", "64%", "76%", "52%"];

/** Placeholder post cards shaped like the feed. */
export function FeedSkeleton({ label = "Loading posts…" }: { label?: string }) {
  return (
    <div className="feed-skeleton">
      <p role="status" className="visually-hidden">
        {label}
      </p>
      <ul aria-hidden="true">
        {FEED_TITLES.map((width, index) => (
          <li key={index}>
            <span className="skeleton-row">
              <span className="skeleton skeleton-chip" />
              <span className="skeleton skeleton-title" style={{ width }} />
            </span>
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line short" />
            <span className="skeleton skeleton-meta" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Placeholder for an open post: kind, title, byline, actions and body. */
export function PostSkeleton({ label = "Loading post…" }: { label?: string }) {
  return (
    <div className="post-skeleton">
      <p role="status" className="visually-hidden">
        {label}
      </p>
      <div aria-hidden="true">
        <span className="skeleton skeleton-kind" />
        <span className="skeleton skeleton-heading" />
        <span className="skeleton skeleton-meta wide" />
        <span className="skeleton-row actions">
          {[5.5, 6.5, 4, 8].map((width) => (
            <span
              key={width}
              className="skeleton skeleton-button"
              style={{ width: `${width}rem` }}
            />
          ))}
        </span>
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line short" />
      </div>
    </div>
  );
}

/** A few text lines, for content inside a section that is already drawn. */
export function LinesSkeleton({
  label,
  lines = 2,
}: {
  label: string;
  lines?: number;
}) {
  return (
    <div className="lines-skeleton">
      <p role="status" className="visually-hidden">
        {label}
      </p>
      <div aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className={`skeleton skeleton-line${index === lines - 1 ? " short" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
