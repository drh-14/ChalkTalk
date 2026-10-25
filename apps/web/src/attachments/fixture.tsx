import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Discussion } from "../posts/views.js";
import "../styles.css";

export function Fixture() {
  const [postId, setPostId] = useState(
    new URLSearchParams(location.search).get("post") === "none"
      ? undefined
      : (new URLSearchParams(location.search).get("post") ?? "p1"),
  );
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
        query={new URLSearchParams(location.search).get("q") ?? undefined}
        postId={postId}
        onNavigate={(path) => {
          const id = path.match(/\/posts\/([^/?]+)/)?.[1];
          if (id) setPostId(id);
        }}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
