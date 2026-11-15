import { Suspense, lazy, type MouseEvent } from "react";
import type { PostAnchor } from "../posts/client.js";
import { viewerPath } from "./client.js";

// pdf.js loads only when an anchored post is opened, never for feed cards.
const AnchorCrop = lazy(() => import("./AnchorCrop.js"));

/** The slides and page a feed card's post asks about. */
export function AnchorChip({ anchor }: { anchor: PostAnchor }) {
  const text =
    anchor.status === "unavailable"
      ? "Slides unavailable"
      : `${anchor.resourceTitle} · p. ${anchor.page}${anchor.status === "earlier_version" ? " · earlier version" : ""}`;
  return (
    <span className="post-card-extras post-card-anchor" title={text}>
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
      {text}
    </span>
  );
}

/** Where an anchored post points, above its body in the post detail. */
export function AnchorBlock({
  courseId,
  postId,
  anchor,
  onNavigate,
}: {
  courseId: string;
  postId: string;
  anchor: PostAnchor;
  onNavigate: (path: string) => void;
}) {
  if (anchor.status === "unavailable")
    return (
      <p className="post-anchor post-anchor-note">
        The slides for this question are no longer available.
      </p>
    );
  const follow = (path: string) => (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onNavigate(path);
  };
  if (anchor.status === "earlier_version") {
    const path = viewerPath(courseId, anchor.resourceId);
    return (
      <p className="post-anchor post-anchor-note">
        Asked about page {anchor.page} of an earlier version of{" "}
        <a href={path} onClick={follow(path)}>
          {anchor.resourceTitle}
        </a>
        .
      </p>
    );
  }
  const path = viewerPath(courseId, anchor.resourceId, anchor.page, postId);
  const label = `${anchor.resourceTitle}, page ${anchor.page}`;
  return (
    <div className="post-anchor">
      <Suspense
        fallback={
          <figure
            className="anchor-crop loading"
            role="img"
            aria-label={label}
          />
        }
      >
        <AnchorCrop
          courseId={courseId}
          fileId={anchor.fileId}
          page={anchor.page}
          box={anchor.box}
          label={`The asked-about area of ${label}`}
        />
      </Suspense>
      <p className="post-anchor-caption">
        <span>
          {anchor.resourceTitle} · page {anchor.page}
        </span>
        <a href={path} onClick={follow(path)}>
          View on slides
        </a>
      </p>
    </div>
  );
}
