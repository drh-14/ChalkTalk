import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LiveBodyEditor } from "./LiveBodyEditor.js";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

let providerConfiguration:
  | {
      token: () => Promise<string>;
      document: import("yjs").Doc;
      name: string;
      onSynced: () => void;
      onStatus: (event: { status: string }) => void;
      onClose: () => void;
      onUnsyncedChanges: (event: { number: number }) => void;
    }
  | undefined;
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    constructor(configuration: typeof providerConfiguration) {
      providerConfiguration = configuration;
      queueMicrotask(() => {
        configuration?.document.getText("content").insert(0, "Initial");
        configuration?.onSynced();
      });
    }
    destroy() {}
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  providerConfiguration = undefined;
});

it("loads the collaborative Markdown editor and requests a fresh ticket on each authentication", async () => {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            ticket: "fresh",
            documentName: "answer:a1",
            expiresInSeconds: 300,
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const done = vi.fn().mockResolvedValue(undefined);
  render(
    <LiveBodyEditor
      kind="answer"
      id="a1"
      csrfToken="csrf"
      onDone={done}
      onFallback={vi.fn()}
    />,
  );
  const editor = await screen.findByRole("textbox", { name: "Answer" });
  expect(editor.textContent).toContain("Initial");
  await expect(providerConfiguration?.token()).resolves.toBe("fresh");
  await expect(providerConfiguration?.token()).resolves.toBe("fresh");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  providerConfiguration?.onUnsyncedChanges({ number: 1 });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  providerConfiguration?.onUnsyncedChanges({ number: 0 });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
});

it("retains a disconnected draft and reattaches with a fresh session on retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            ticket: "fresh",
            documentName: "answer:a1",
            expiresInSeconds: 300,
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  const fallback = vi.fn();
  const confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal("confirm", confirm);
  render(
    <LiveBodyEditor
      kind="answer"
      id="a1"
      csrfToken="csrf"
      onDone={vi.fn()}
      onFallback={fallback}
    />,
  );
  await screen.findByRole("textbox", { name: "Answer" });
  const initial = providerConfiguration;
  initial?.document.getText("content").insert(7, " local draft");
  initial?.onClose();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Use standard editor" }));
  expect(confirm).toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Retry connection" }));
  await waitFor(() => expect(providerConfiguration).not.toBe(initial));
  expect(providerConfiguration?.document).toBe(initial?.document);
  expect(
    providerConfiguration?.document.getText("content").toString(),
  ).toContain("local draft");
  await expect(providerConfiguration?.token()).resolves.toBe("fresh");
});
