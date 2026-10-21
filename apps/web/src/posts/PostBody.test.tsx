import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PostBody } from "./PostBody.js";

afterEach(cleanup);

it("renders Markdown and inline and display math from stored source", () => {
  const { container } = render(
    <PostBody
      bodyMarkdown={
        "**cutoff** and [notes](https://example.edu) with $x^2$\n\n$$\n\\frac{1}{2}\n$$"
      }
    />,
  );
  expect(screen.getByText("cutoff").tagName).toBe("STRONG");
  expect(screen.getByRole("link", { name: "notes" }).getAttribute("href")).toBe(
    "https://example.edu",
  );
  expect(container.querySelector(".katex:not(.katex-display)"))?.toBeTruthy();
  expect(container.querySelector(".katex-display"))?.toBeTruthy();
  expect(container.textContent).toContain("frac");
});

it("keeps invalid math readable and hostile author content inert", () => {
  const { container } = render(
    <PostBody
      bodyMarkdown={
        "before $\\notacommand$ after <img src=x onerror=alert(1)> [bad](javascript:alert(1))"
      }
    />,
  );
  expect(container.textContent).toContain("before");
  expect(container.textContent).toContain("\\notacommand");
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  expect(
    screen.getByText("bad").closest("a")?.getAttribute("href") ?? "",
  ).not.toMatch(/^javascript:/);
});

it("renders a mention as a highlighted name rather than a link", () => {
  const { container } = render(
    <PostBody
      bodyMarkdown={
        "Thanks [@Grace Hopper](mention:01a0e5cc-58ae-7009-9f43-c0ffee000001) and @staff, see [bad](mention:not-a-user)"
      }
    />,
  );
  const mention = screen.getByText("@Grace Hopper");
  expect(mention.tagName).toBe("SPAN");
  expect(mention.className).toBe("mention");
  expect(mention.closest("a")).toBeNull();
  expect(container.textContent).toContain("@staff");
  // A malformed mention target is dropped like any unknown protocol.
  expect(screen.getByText("bad").getAttribute("href") ?? "").toBe("");
  expect(container.querySelectorAll(".mention")).toHaveLength(1);
});
