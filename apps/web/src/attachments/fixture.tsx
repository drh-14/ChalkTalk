import { useState } from "react";
import { createRoot } from "react-dom/client";
import { filtersFromSearch, type FeedFilters } from "../app/routes.js";
import { Discussion } from "../posts/views.js";
import "../styles.css";

export function Fixture() {
  const sharedFilters = new URLSearchParams(location.search).has(
    "sharedFilters",
  );
  const [filters, setFilters] = useState<FeedFilters>(() =>
    filtersFromSearch(new URLSearchParams(location.search)),
  );
  const [postId, setPostId] = useState<string | undefined>(() => {
    const selected = new URLSearchParams(location.search).get("post");
    return selected === "none" ? undefined : (selected ?? "p1");
  });
  return (
    <main className="course-page discussion">
      <header className="course-header">
        <h1>Physics discussion</h1>
      </header>
      <Discussion
        courseId="course-1"
        course={{
          id: "course-1",
          name: "Physics",
          status:
            new URLSearchParams(location.search).get("status") === "archived"
              ? "archived"
              : "active",
          organizationId: "org-1",
          joinCode: null,
          createdAt: "2026-10-01T00:00:00Z",
          updatedAt: "2026-10-01T00:00:00Z",
          version: 1,
        }}
        csrfToken="fixture-csrf"
        userId="u1"
        postId={postId}
        filters={sharedFilters ? filters : undefined}
        onFiltersChange={
          sharedFilters
            ? (next) => {
                setFilters(next);
                const params = new URLSearchParams(location.search);
                params.delete("folder");
                for (const folder of next.folders ?? [])
                  params.append("folder", folder);
                history.replaceState(
                  null,
                  "",
                  `${location.pathname}?${params}`,
                );
              }
            : undefined
        }
        onNavigate={(path) => {
          const id = path.match(/\/posts\/([^/?]+)/)?.[1];
          setPostId(id);
        }}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
