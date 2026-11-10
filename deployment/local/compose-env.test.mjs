import assert from "node:assert/strict";
import process from "node:process";
import { URL } from "node:url";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("canonical local template resolves the default browser URL and internal API port", () => {
  const config = JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "-f",
        "deployment/local/compose.yml",
        "--env-file",
        "deployment/local/.env.example",
        "config",
        "--format",
        "json",
      ],
      {
        cwd: new URL("../..", import.meta.url),
        env: { ...process.env, COMPOSE_PROJECT_NAME: "" },
        encoding: "utf8",
      },
    ),
  );
  assert.equal(
    config.services.api.environment.FRONTEND_ORIGINS,
    "https://localhost:5173",
  );
  assert.equal(
    config.services.api.environment.FRONTEND_BASE_URL,
    "https://localhost:5173",
  );
  assert.equal(config.services.api.environment.PORT, undefined);
});

test("local Compose derives browser origins from its configured domain and web port", () => {
  const config = JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "-f",
        "deployment/local/compose.yml",
        "--env-file",
        "deployment/local/.env.example",
        "config",
        "--format",
        "json",
      ],
      {
        cwd: new URL("../..", import.meta.url),
        env: {
          ...process.env,
          COMPOSE_ENV_FILE: "deployment/local/.env.example",
          DOMAIN: "local.example.edu",
          WEB_PORT: "5188",
        },
        encoding: "utf8",
      },
    ),
  );
  assert.equal(
    config.services.api.environment.FRONTEND_ORIGINS,
    "https://local.example.edu:5188",
  );
  assert.equal(
    config.services.api.environment.FRONTEND_BASE_URL,
    "https://local.example.edu:5188",
  );
  assert.equal(config.services.api.environment.PORT, undefined);
});

test("canonical local Compose preserves the chalktalk project and accepts isolation override", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(
    existsSync(new URL("../../docker-compose.yml", import.meta.url)),
    false,
  );
  const render = (project) =>
    JSON.parse(
      execFileSync(
        "docker",
        [
          "compose",
          "-f",
          "deployment/local/compose.yml",
          "--env-file",
          "deployment/local/.env.example",
          "config",
          "--format",
          "json",
        ],
        {
          cwd: new URL("../..", import.meta.url),
          env: { ...process.env, COMPOSE_PROJECT_NAME: project },
          encoding: "utf8",
        },
      ),
    );
  assert.equal(render("").name, "chalktalk");
  assert.equal(render("chalktalk_loki_test").name, "chalktalk_loki_test");
});
