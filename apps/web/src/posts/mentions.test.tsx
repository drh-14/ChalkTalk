import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarkdownEditorField } from "./MarkdownEditorField.js";
import {
  MentionContext,
  mentionOptions,
  mentionSuggestions,
} from "./mentions.js";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
beforeEach(() => {
  vi.stubGlobal(
    "Worker",
    class {
      onmessage = null;
      postMessage() {}
      terminate() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// CodeMirror ignores Enter for 75 ms after completions appear, so a fast typist
// does not accept one by accident.
const pastInteractionDelay = () =>
  new Promise((resolve) => setTimeout(resolve, 150));

const grace = {
  userId: "01a0e5cc-58ae-7009-9f43-c0ffee000001",
  displayName: "Grace Hopper",
  role: "ta" as const,
};

function Field({
  source,
}: {
  source?: (query: string) => Promise<(typeof grace)[]>;
}) {
  const [value, setValue] = useState("");
  return (
    <MentionContext.Provider value={source}>
      <MarkdownEditorField label="Followup" value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </MentionContext.Provider>
  );
}

it("suggests @staff and members after @ and inserts the mention token", async () => {
  const source = vi.fn(async () => [grace]);
  const user = userEvent.setup();
  render(<Field source={source} />);
  await user.click(screen.getByRole("textbox", { name: "Followup" }));
  await user.keyboard("Hi @gra");
  const option = await screen.findByRole("option", { name: /@Grace Hopper/ });
  expect(option.textContent).toContain("TA");
  expect(source).toHaveBeenLastCalledWith("gra");
  // @staff only shows while the typed text could still be "staff".
  expect(screen.queryByRole("option", { name: /@staff/ })).toBeNull();
  await pastInteractionDelay();
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(screen.getByTestId("value").textContent).toBe(
      `Hi [@Grace Hopper](mention:${grace.userId}) `,
    ),
  );
});

it("offers @staff first and leaves @ alone without a source or inside words", async () => {
  const user = userEvent.setup();
  const source = vi.fn(async () => [grace]);
  const { unmount } = render(<Field source={source} />);
  await user.click(screen.getByRole("textbox", { name: "Followup" }));
  await user.keyboard("@st");
  await waitFor(() => expect(source).toHaveBeenLastCalledWith("st"));
  await screen.findByRole("option", { name: /@staff/, selected: true });
  const options = screen.getAllByRole("option");
  expect(options[0]!.textContent).toContain("@staff");
  await pastInteractionDelay();
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(screen.getByTestId("value").textContent).toBe("@staff "),
  );
  unmount();

  render(<Field />);
  await user.click(screen.getByRole("textbox", { name: "Followup" }));
  await user.keyboard("mail me@gra");
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(screen.queryByRole("option")).toBeNull();
});

it("builds options and requests suggestions for a post", async () => {
  expect(mentionOptions("", [{ ...grace, displayName: "Ada [x]" }])).toEqual([
    expect.objectContaining({ label: "@staff" }),
    expect.objectContaining({
      label: "@Ada [x]",
      apply: `[@Ada x](mention:${grace.userId}) `,
    }),
  ]);
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: [grace] }), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await expect(mentionSuggestions("course-1", "gr", "post-1")).resolves.toEqual(
    [grace],
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/courses/course-1/mention-suggestions?q=gr&postId=post-1",
    expect.objectContaining({ credentials: "include" }),
  );
});
