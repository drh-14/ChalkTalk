import { expect, it } from "vitest";
import { responsePreview } from "./service.js";

it("projects Markdown responses as bounded plain-text previews", () => {
  const preview = responsePreview(
    "**Important** [@Teaching Assistant](mention:01a0e5cc-58ae-7009-9f43-ddd412c3880b)\n\n" +
      "See [the guide](https://example.edu/private) and `stop` here.\n" +
      "![diagram](https://example.edu/image.png)\nFourth line",
  );
  expect(preview).toBe(
    "Important @Teaching Assistant\n" +
      "See the guide and stop here.\n" +
      "diagram",
  );
  expect(responsePreview(`**${"x".repeat(400)}**`)).toHaveLength(360);
});
