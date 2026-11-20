import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "../app/ConfirmDialog.js";
import { Discussion } from "./views.js";
import "../styles.css";

const root = createRoot(document.getElementById("root")!);
function render() {
  const params = new URLSearchParams(window.location.search);
  const role = params.get("role") ?? "student";
  const kind = params.get("kind") ?? "question";
  const postId =
    params.get("post") ??
    (kind === "poll" ? "fixture-poll" : "fixture-question");
  root.render(
    <ConfirmProvider>
      <Discussion
        courseId="fixture-course"
        course={{
          id: "fixture-course",
          organizationId: "fixture-org",
          name: "Physics",
          status: "active",
          allowAnonymousPosting: true,
          allowPrivatePosting: true,
          allowFollowupResolution: true,
          joinCode: null,
          createdAt: "2026-10-21T00:00:00Z",
          updatedAt: "2026-10-21T00:00:00Z",
          version: 1,
        }}
        userId={role === "ta" ? "fixture-staff" : "fixture-student"}
        postId={postId}
        query={params.get("q") ?? undefined}
        csrfToken="fixture-csrf"
        onNavigate={(path) => {
          window.history.pushState({}, "", path);
        }}
      />
    </ConfirmProvider>,
  );
}
render();
window.addEventListener("popstate", render);
