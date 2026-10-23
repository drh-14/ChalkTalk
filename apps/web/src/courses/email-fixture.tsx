import { createRoot } from "react-dom/client";
import { CourseDetail } from "./views.js";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <CourseDetail
    courseId="fixture-course"
    userId="fixture-user"
    csrfToken="fixture-csrf"
    onBack={() => {}}
  />,
);
