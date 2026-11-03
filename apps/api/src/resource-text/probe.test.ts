import { describe, expect, it } from "vitest";
import { missingExtractionTools } from "./probe.js";
import { ExtractionFailure, type runTool } from "./tools.js";

const fakeRun =
  (absent: string[], languages = "eng\nosd"): typeof runTool =>
  async (command) => {
    if (absent.includes(command))
      throw new ExtractionFailure("tool_unavailable", false);
    return {
      code: 0,
      stdout: Buffer.from(
        command === "tesseract"
          ? `List of available languages in "/usr/share" (2):\n${languages}\n`
          : "",
      ),
      stderr: "",
      truncated: false,
    };
  };

describe("missingExtractionTools", () => {
  it("is empty when every tool and configured language is installed", async () => {
    expect(await missingExtractionTools("eng", fakeRun([]))).toEqual([]);
  });

  it("reports missing binaries", async () => {
    expect(
      await missingExtractionTools("eng", fakeRun(["pdftoppm", "tesseract"])),
    ).toEqual(["pdftoppm", "tesseract"]);
  });

  it("reports configured languages without trained data", async () => {
    expect(
      await missingExtractionTools("eng+spa+deu", fakeRun([], "eng\nspa")),
    ).toEqual(["tesseract:deu"]);
  });
});
