import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmProvider } from "./ConfirmDialog.js";
import { useConfirm } from "./useConfirm.js";

afterEach(cleanup);

function Trigger({ onResult }: { onResult: (value: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button onClick={() => void confirm("Discard changes?").then(onResult)}>
      Leave
    </button>
  );
}

it("confirms once in a labeled ChalkTalk dialog and restores focus", async () => {
  const onResult = vi.fn();
  render(
    <ConfirmProvider>
      <Trigger onResult={onResult} />
    </ConfirmProvider>,
  );
  const trigger = screen.getByRole("button", { name: "Leave" });
  await userEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Confirm action" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(onResult).toHaveBeenCalledWith(true);
  expect(document.activeElement).toBe(trigger);
});

it("cancels on Escape without executing the action", async () => {
  const onResult = vi.fn();
  render(
    <ConfirmProvider>
      <Trigger onResult={onResult} />
    </ConfirmProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Leave" }));
  await userEvent.keyboard("{Escape}");
  expect(onResult).toHaveBeenCalledWith(false);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("supports a destructive action label and tone", async () => {
  function DeleteTrigger() {
    const confirm = useConfirm();
    return (
      <button
        onClick={() =>
          void confirm({
            message: "Delete this post?",
            title: "Delete post",
            confirmLabel: "Delete",
            destructive: true,
          })
        }
      >
        Delete post
      </button>
    );
  }
  render(
    <ConfirmProvider>
      <DeleteTrigger />
    </ConfirmProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete post" }));
  const dialog = screen.getByRole("dialog", { name: "Delete post" });
  expect(dialog.textContent).toContain("Delete this post?");
  expect(screen.getByRole("button", { name: "Delete" }).className).toContain(
    "danger",
  );
});

it("keeps keyboard Tab focus within the dialog", async () => {
  render(
    <ConfirmProvider>
      <Trigger onResult={() => {}} />
    </ConfirmProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Leave" }));
  const cancel = screen.getByRole("button", { name: "Cancel" });
  const confirm = screen.getByRole("button", { name: "Confirm" });
  expect(document.activeElement).toBe(cancel);
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  expect(document.activeElement).toBe(confirm);
  await userEvent.keyboard("{Tab}");
  expect(document.activeElement).toBe(cancel);
});

it("does not stack repeated confirmation requests", async () => {
  const result = vi.fn();
  function Twice() {
    const confirm = useConfirm();
    return (
      <button
        onClick={() => {
          void confirm("First request?").then(result);
          void confirm("Second request?").then(result);
        }}
      >
        Ask twice
      </button>
    );
  }
  render(
    <ConfirmProvider>
      <Twice />
    </ConfirmProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Ask twice" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("dialog").textContent).toContain("First request?");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(result.mock.calls).toEqual([[false], [true]]);
});
