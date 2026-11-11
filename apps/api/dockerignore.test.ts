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

const roles = ["api", "worker", "collaboration", "frontend"];
const roots = ["deployment/local", "deployment/production"];

describe("Docker build context policy", () => {
  it.each(roots.flatMap((root) => roles.map((role) => [root, role])))(
    "%s Dockerfile.%s build excludes credentials and worktrees but keeps safe templates",
    (dockerfileDirectory, role) => {
      const root = mkdtempSync(resolve(process.cwd(), ".dockerignore-test-"));
      const context = join(root, "context");
      const output = join(root, "output");
      try {
        mkdirSync(context);
        mkdirSync(output);
        const dockerfile = join(
          context,
          dockerfileDirectory,
          `Dockerfile.${role}`,
        );
        mkdirSync(resolve(dockerfile, ".."), { recursive: true });
        writeFileSync(dockerfile, "FROM scratch\nCOPY . /\n");
        copyFileSync(
          resolve(
            process.cwd(),
            dockerfileDirectory,
            `Dockerfile.${role}.dockerignore`,
          ),
          `${dockerfile}.dockerignore`,
        );
        for (const path of [
          ".env",
          "deployment/local/.env",
          "deployment/production/.env",
          ".git/HEAD",
          "node_modules/secret",
          ".worktrees/other/secret",
          "deployment/local/.env.example",
          "deployment/production/.env.example",
        ]) {
          const destination = join(context, path);
          mkdirSync(resolve(destination, ".."), { recursive: true });
          writeFileSync(destination, path);
        }
        execFileSync(
          "docker",
          [
            "buildx",
            "build",
            "--file",
            dockerfile,
            "--output",
            `type=local,dest=${output}`,
            context,
          ],
          { stdio: "pipe" },
        );
        for (const path of [
          ".env",
          "deployment/local/.env",
          "deployment/production/.env",
          ".git/HEAD",
          "node_modules/secret",
          ".worktrees/other/secret",
        ])
          expect(existsSync(join(output, path))).toBe(false);
        for (const path of [
          "deployment/local/.env.example",
          "deployment/production/.env.example",
        ])
          expect(readFileSync(join(output, path), "utf8")).toBe(path);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
