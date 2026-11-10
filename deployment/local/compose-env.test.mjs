import assert from "node:assert/strict";
import process from "node:process";
import { URL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
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
        env: {
          ...process.env,
          COMPOSE_ENV_FILE: "deployment/local/.env.example",
          COMPOSE_PROJECT_NAME: "",
        },
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
          env: {
            ...process.env,
            COMPOSE_ENV_FILE: "deployment/local/.env.example",
            COMPOSE_PROJECT_NAME: project,
          },
          encoding: "utf8",
        },
      ),
    );
  assert.equal(render("").name, "chalktalk");
  assert.equal(render("chalktalk_loki_test").name, "chalktalk_loki_test");
});

test("local Compose rejects legacy PORT before migrations and starts migrations without it", () => {
  const root = new URL("../..", import.meta.url);
  const directory = mkdtempSync(
    new URL("../../.compose-port-test-", import.meta.url).pathname,
  );
  const bin = join(directory, "bin");
  const log = join(directory, "npm.log");
  mkdirSync(bin);
  writeFileSync(log, "");
  writeFileSync(join(bin, "npm"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$NPM_LOG"\n');
  chmodSync(join(bin, "npm"), 0o755);

  const runMigrate = (envFile) => {
    const config = JSON.parse(
      execFileSync(
        "docker",
        [
          "compose",
          "-f",
          "deployment/local/compose.yml",
          "--env-file",
          envFile,
          "config",
          "--format",
          "json",
        ],
        {
          cwd: root,
          env: { ...process.env, COMPOSE_ENV_FILE: envFile },
          encoding: "utf8",
        },
      ),
    );
    const [executable, ...args] = config.services.migrate.command;
    return spawnSync(executable, args.map((arg) => arg.replaceAll("$$", "$")), {
      cwd: root,
      env: {
        ...config.services.migrate.environment,
        PATH: `${bin}:${process.env.PATH}`,
        NPM_LOG: log,
      },
      encoding: "utf8",
    });
  };

  try {
    const template = readFileSync(new URL(".env.example", import.meta.url), "utf8");
    const legacyFile = `${basename(directory)}/legacy.env`;
    writeFileSync(join(directory, "legacy.env"), `${template}\nPORT=3002\n`);
    const legacy = runMigrate(legacyFile);
    assert.notEqual(legacy.status, 0);
    assert.match(legacy.stderr, /remove PORT from \.env/i);
    assert.equal(readFileSync(log, "utf8"), "");

    const currentFile = `${basename(directory)}/current.env`;
    writeFileSync(join(directory, "current.env"), template);
    const current = runMigrate(currentFile);
    assert.equal(current.status, 0, current.stderr);
    assert.equal(
      readFileSync(log, "utf8"),
      "run db:migrate\nrun migrate:semantic --workspace=@chalktalk/api\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
