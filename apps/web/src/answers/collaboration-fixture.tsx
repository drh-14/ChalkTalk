import { createRoot } from "react-dom/client";
import { LiveBodyEditor } from "./LiveBodyEditor.js";
import "../styles.css";

const parameters = new URLSearchParams(location.search);
const kind = parameters.get("kind");
if (kind !== "answer" && kind !== "followup")
  throw new Error("Invalid fixture kind");
createRoot(document.getElementById("root")!).render(
  <main style={{ maxWidth: 800, margin: "2rem auto" }}>
    <h1>Live {kind} editor fixture</h1>
    <LiveBodyEditor
      kind={kind}
      id="01a0e5cc-58ae-7009-9f43-ea8bbebc2e08"
      csrfToken="fixture-csrf"
      onDone={async () => {}}
      onFallback={() => {}}
    />
  </main>,
);
