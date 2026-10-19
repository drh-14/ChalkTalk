import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("Compose bounds API and worker Docker stdout logs", () => {
  const config = JSON.parse(
    execFileSync(
      "docker",
      ["compose", "--profile", "app", "config", "--format", "json"],
      {
        cwd: new URL("../..", import.meta.url),
        env: { ...process.env, COMPOSE_ENV_FILE: ".env.example" },
        encoding: "utf8",
      },
    ),
  );
  for (const service of ["api", "worker"]) {
    assert.deepEqual(config.services[service].logging, {
      driver: "local",
      options: { "max-size": "20m", "max-file": "5" },
    });
  }
});
