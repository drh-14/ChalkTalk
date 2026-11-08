import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Docker build context policy", () => {
  it("excludes deployment credentials without excluding safe templates", () => {
    const root = mkdtempSync(resolve(process.cwd(), ".dockerignore-test-"));
    const context = join(root, "context");
    const output = join(root, "output");
    const credentials = [
      ".env",
      "deployment/local/.env",
      "deployment/production/.env",
    ];
    const templates = [
      ".env.example",
      "deployment/local/.env.example",
      "deployment/production/.env.example",
    ];

    try {
      mkdirSync(context);
      mkdirSync(output);
      copyFileSync(resolve(process.cwd(), ".dockerignore"), join(context, ".dockerignore"));
      writeFileSync(join(context, "Dockerfile"), "FROM scratch\nCOPY . /\n");
      for (const path of [...credentials, ...templates]) {
        const destination = join(context, path);
        mkdirSync(resolve(destination, ".."), { recursive: true });
        writeFileSync(destination, path);
      }

      execFileSync(
        "docker",
        ["buildx", "build", "--output", `type=local,dest=${output}`, context],
        { stdio: "pipe" },
      );

      for (const path of credentials) expect(existsSync(join(output, path))).toBe(false);
      for (const path of templates)
        expect(readFileSync(join(output, path), "utf8")).toBe(path);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
