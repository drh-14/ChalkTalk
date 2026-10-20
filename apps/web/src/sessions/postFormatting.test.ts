import { expect, it } from "vitest";
import { codeBlock, postBody } from "./postFormatting.js";

it("fences code with the session language", () => {
  expect(codeBlock("while True:\n    break", "python")).toBe(
    "```python\nwhile True:\n    break\n```",
  );
  expect(codeBlock("int x;\n", "cpp")).toBe("```cpp\nint x;\n```");
  expect(codeBlock("notes", "plaintext")).toBe("```\nnotes\n```");
});

it("uses a fence longer than any backtick run in the code", () => {
  expect(codeBlock("s = '```'", "python")).toBe("````python\ns = '```'\n````");
  expect(codeBlock("`a` ``b``", "javascript")).toBe(
    "```javascript\n`a` ``b``\n```",
  );
});

it("puts a trimmed note before the content", () => {
  expect(postBody("  Fixed: the loop now breaks. \n", "```\nx\n```")).toBe(
    "Fixed: the loop now breaks.\n\n```\nx\n```",
  );
  expect(postBody("   ", "content")).toBe("content");
});
