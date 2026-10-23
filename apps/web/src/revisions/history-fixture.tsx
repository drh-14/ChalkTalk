import { createRoot } from "react-dom/client";
import { Discussion } from "../posts/views.js";
import type { Course } from "../courses/client.js";
import "../styles.css";

const params = new URLSearchParams(window.location.search);
const course: Course = {
  id: "fixture-course",
  organizationId: "fixture-organization",
  name: "Revision history course",
  status: params.get("archived") === "1" ? "archived" : "active",
  joinCode: null,
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
  version: 1,
};

createRoot(document.getElementById("root")!).render(
  <Discussion
    courseId={course.id}
    course={course}
    userId="viewer"
    postId="fixture-post"
    csrfToken="browser-csrf"
    onNavigate={() => {}}
  />,
);
