import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "../app/ConfirmDialog.js";
import { QuestionResponses } from "./views.js";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <ConfirmProvider>
    <main style={{ maxWidth: 800, margin: "2rem auto" }}>
      <QuestionResponses
        postId="fixture-post"
        role="student"
        courseStatus="active"
        csrfToken="fixture-csrf"
      />
    </main>
  </ConfirmProvider>,
);
