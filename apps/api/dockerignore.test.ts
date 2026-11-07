import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type IgnoreRule = { path: string; exclude: boolean };

function dockerContextPolicy(): IgnoreRule[] {
  return readFileSync(resolve(process.cwd(), ".dockerignore"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => ({
      path: line.replace(/^!/, "").replace(/^\//, "").replace(/\/$/, ""),
      exclude: !line.startsWith("!"),
    }));
}

function excludedFromContext(path: string, rules: IgnoreRule[]): boolean {
  let excluded = false;
  for (const rule of rules)
    if (path === rule.path || path.startsWith(`${rule.path}/`))
      excluded = rule.exclude;
  return excluded;
}

describe("Docker build context policy", () => {
  it("excludes deployment credentials without excluding safe templates", () => {
    const rules = dockerContextPolicy();
    for (const path of [
      ".env",
      "deployment/local/.env",
      "deployment/production/.env",
    ])
      expect(excludedFromContext(path, rules)).toBe(true);
    for (const path of [
      ".env.example",
      "deployment/local/.env.example",
      "deployment/production/.env.example",
    ])
      expect(excludedFromContext(path, rules)).toBe(false);
  });
});
