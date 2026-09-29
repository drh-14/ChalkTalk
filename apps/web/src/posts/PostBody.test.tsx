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
