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
  expect(screen.getByRole("link", { name: "notes" })).toHaveProperty(
    "target",
    "_blank",
  );
  expect(screen.getByRole("link", { name: "notes" }).getAttribute("rel")).toBe(
    "noopener noreferrer",
  );
  expect(container.querySelector(".katex:not(.katex-display)"))?.toBeTruthy();
  expect(container.querySelector(".katex-display"))?.toBeTruthy();
  expect(container.textContent).toContain("frac");
});

it("keeps in-app Markdown links in the current tab", () => {
  render(
    <PostBody
      bodyMarkdown={`[course](/courses/course-1) and [absolute course](${window.location.origin}/courses/course-1)`}
    />,
  );
  expect(
    screen.getByRole("link", { name: "course" }).getAttribute("target"),
  ).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "absolute course" })
      .getAttribute("target"),
  ).toBeNull();
});

it("opens relative and same-origin file links separately", () => {
  render(
    <PostBody
      bodyMarkdown={`[notes](/documents/notes.pdf?download=1) and [slides](${window.location.origin}/files/slides.pptx) and [attachment](/api/v1/attachments/a1/download)`}
    />,
  );
  for (const name of ["notes", "slides", "attachment"]) {
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  }
});

it("does not treat email links as website or file navigation", () => {
  render(<PostBody bodyMarkdown="[email](mailto:teacher@example.edu)" />);
  expect(
    screen.getByRole("link", { name: "email" }).getAttribute("target"),
  ).toBeNull();
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

it("renders GitHub-flavored tables, strikethrough, and bare URLs", () => {
  const { container } = render(
    <PostBody
      bodyMarkdown={
        "|  | Excellent | Good |\n| --- | --- | --- |\n| Instructor | 7 | 6 |\n\n~~old~~ see https://example.edu/notes"
      }
    />,
  );
  const table = screen.getByRole("table");
  expect(table.parentElement?.className).toBe("table-scroll");
  expect(
    screen.getAllByRole("columnheader").map((cell) => cell.textContent),
  ).toEqual(["", "Excellent", "Good"]);
  expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "Instructor",
    "7",
    "6",
  ]);
  expect(screen.getByText("old").tagName).toBe("DEL");
  expect(
    screen
      .getByRole("link", { name: "https://example.edu/notes" })
      .getAttribute("href"),
  ).toBe("https://example.edu/notes");
  expect(container.querySelector("script")).toBeNull();
});
