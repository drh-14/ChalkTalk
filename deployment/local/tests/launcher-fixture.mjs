import process from "node:process";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  accessSync,
  constants,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const realDocker = process.env.PATH.split(":")
  .map((path) => join(path, "docker"))
  .find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
const launcher = resolve("deployment/local/start.sh");
export const baseline = {
  AUTH_TOKEN_SECRET: "synthetic-auth-secret-with-at-least-32-characters",
  METRICS_TOKEN: "synthetic-metrics-token-with-32-characters",
  GRAFANA_ADMIN_PASSWORD: "synthetic-grafana-password",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "ChalkTalk <mail@example.test>",
  RESEND_API_KEY: "synthetic-resend-key",
};
export function invoke(
  overrides = {},
  {
    raw,
    args = [],
    inherited = {},
    failure = "",
    realRender = false,
    ciHarness = false,
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "chalktalk-launcher-"));
  const log = join(dir, "docker.log");
  const envFile = join(dir, "operator.env");
  writeFileSync(
    envFile,
    (typeof raw === "function" ? raw(dir) : raw) ??
      Object.entries({ ...baseline, ...overrides })
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
  );
  writeFileSync(
    join(dir, "docker"),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
${realRender ? `case "$*" in *'config --format json'*) '${realDocker}' "$@" > '${dir}/model.json' 2> '${dir}/model.err'; exit $? ;; esac` : ""}
${failure ? `case "$*" in *'${failure}'*) exit 1 ;; esac` : ""}
exit 0
`,
    { mode: 0o700 },
  );
  try {
    const result = spawnSync(
      ciHarness ? process.execPath : "/bin/sh",
      [
        ciHarness ? resolve("deployment/local/tests/ci-start.mjs") : launcher,
        "--env-file",
        envFile,
        ...args,
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          PATH: `${dir}:/usr/bin:/bin`,
          HOME: dir,
          CALL_LOG: log,
          ...(realRender
            ? { DOCKER_CONFIG: join(process.env.HOME, ".docker") }
            : {}),
          ...inherited,
        },
      },
    );
    let calls = "";
    try {
      calls = readFileSync(log, "utf8");
    } catch {
      /* No generated output exists before this boundary. */
    }
    let model;
    try {
      model = JSON.parse(readFileSync(join(dir, "model.json"), "utf8"));
    } catch {
      /* No generated output exists before this boundary. */
    }
    let renderError = "";
    try {
      renderError = readFileSync(join(dir, "model.err"), "utf8");
    } catch {
      /* No generated output exists before this boundary. */
    }
    return {
      ...result,
      calls,
      model,
      renderError,
      probeCreated: existsSync(join(dir, "probe")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
