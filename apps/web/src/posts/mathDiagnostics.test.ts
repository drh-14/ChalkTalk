import { expect, it } from "vitest";
import { getMathAnalysis } from "./mathDiagnostics.js";

it("finds exact source ranges for complete valid inline and block math", () => {
  expect(getMathAnalysis("A $x^2$ B\n$$\n\\frac{1}{2}\n$$")).toMatchObject({
    formulas: [
      { from: 2, to: 7, tex: "x^2", displayMode: false },
      { from: 10, to: 27, tex: "\\frac{1}{2}", displayMode: true },
    ],
    diagnostics: [],
  });
});

it("renders only valid complete math outside escaped and code source", () => {
  expect(getMathAnalysis("\\$5 and `$y$`")).toEqual({
    formulas: [],
    diagnostics: [],
  });
  expect(getMathAnalysis("$z$ $\\badcommand$ $open")).toMatchObject({
    formulas: [{ from: 0, to: 3, tex: "z", displayMode: false }],
    diagnostics: [{ from: 4, to: 17 }],
  });
});

it("marks only a complete invalid inline expression at its source range", () => {
  expect(getMathAnalysis("A $\\badcommand$ B").diagnostics).toMatchObject([
    { from: 2, to: 15 },
  ]);
  expect(getMathAnalysis("A $x^2$ B").diagnostics).toEqual([]);
  expect(getMathAnalysis("A $\\badcommand B").diagnostics).toEqual([]);
  expect(getMathAnalysis("A\n$$\n\\badcommand").diagnostics).toEqual([]);
});

it("marks rejected block math and clears it immediately after a correction", () => {
  expect(
    getMathAnalysis("before\n$$\n\\badcommand\n$$\nafter").diagnostics,
  ).toMatchObject([{ from: 7, to: 24 }]);
  expect(getMathAnalysis("before\n$$\nx^2\n$$\nafter").diagnostics).toEqual([]);
});

it("ignores escaped dollars, code spans, and permissive Markdown", () => {
  expect(
    getMathAnalysis("**open \\$\\badcommand$ and `$\\badcommand$`").diagnostics,
  ).toEqual([]);
});
