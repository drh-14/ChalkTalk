import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import * as Y from "yjs";
import { CodeEditor } from "./CodeEditor.js";

afterEach(cleanup);

const content = () => document.querySelector(".cm-content") as HTMLElement;
const shown = () =>
  [...document.querySelectorAll(".cm-line")]
    .map((line) => line.textContent)
    .join("\n");

it("shows the shared text with line numbers and keeps it when the language changes", () => {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, "def f():\n    return 1");
  const { rerender } = render(
    <CodeEditor text={text} language="python" readOnly={false} />,
  );
  expect(shown()).toBe("def f():\n    return 1");
  expect(
    document.querySelectorAll(".cm-lineNumbers .cm-gutterElement").length,
  ).toBeGreaterThan(1);
  expect(
    document.querySelector(".code-editor")?.getAttribute("data-language"),
  ).toBe("python");
  rerender(<CodeEditor text={text} language="java" readOnly={false} />);
  expect(
    document.querySelector(".code-editor")?.getAttribute("data-language"),
  ).toBe("java");
  expect(shown()).toBe("def f():\n    return 1");
  expect(text.toString()).toBe("def f():\n    return 1");
});

it("labels the editor for assistive technology", () => {
  const text = new Y.Doc().getText("content");
  render(
    <CodeEditor
      text={text}
      language="plaintext"
      readOnly={false}
      label="Shared code"
    />,
  );
  expect(screen.getByLabelText("Shared code")).toBe(content());
});

it("blocks input while read-only and allows it again when editable", () => {
  const text = new Y.Doc().getText("content");
  const { rerender } = render(
    <CodeEditor text={text} language="sql" readOnly />,
  );
  expect(content().getAttribute("contenteditable")).toBe("false");
  rerender(<CodeEditor text={text} language="sql" readOnly={false} />);
  expect(content().getAttribute("contenteditable")).toBe("true");
});

it("reflects remote Yjs edits without replacing the whole buffer", () => {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, "a\nb");
  render(<CodeEditor text={text} language="plaintext" readOnly={false} />);
  act(() => {
    text.insert(1, " (remote)");
  });
  expect(shown()).toBe("a (remote)\nb");
});

it("lets keyboard users leave with Escape, then Tab, and says so", async () => {
  const text = new Y.Doc().getText("content");
  render(<CodeEditor text={text} language="python" readOnly={false} />);
  await userEvent.click(content());
  expect(document.querySelector(".code-editor-hint.visible")?.textContent).toBe(
    "Press Esc, then Tab, to leave the editor",
  );
  expect(content().getAttribute("aria-describedby")).toBe(
    document.querySelector(".code-editor-hint")?.id,
  );
  // CodeMirror reads keyCode, which simulated typing leaves at 0. A Tab the
  // editor does not cancel moves focus on in a browser.
  const press = (key: string, keyCode: number) =>
    content().dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        keyCode,
        bubbles: true,
        cancelable: true,
      }),
    );
  expect(press("Tab", 9)).toBe(false);
  const indented = text.toString();
  expect(indented.length).toBeGreaterThan(0);
  press("Escape", 27);
  expect(press("Tab", 9)).toBe(true);
  expect(text.toString()).toBe(indented);
});
