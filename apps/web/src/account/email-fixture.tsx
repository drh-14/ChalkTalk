import { createRoot } from "react-dom/client";
import { AccountPage } from "./AccountPage.js";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <AccountPage
    session={{
      id: "fixture-session",
      user: {
        id: "fixture-user",
        email: "sam@example.edu",
        displayName: "Sam Student",
        createdAt: "2026-10-21T00:00:00Z",
        updatedAt: "2026-10-21T00:00:00Z",
        version: 1,
      },
      expiresAt: "2026-10-22T00:00:00Z",
      csrfToken: "fixture-csrf",
    }}
    onUserChange={() => {}}
    onDeleted={() => {}}
  />,
);
