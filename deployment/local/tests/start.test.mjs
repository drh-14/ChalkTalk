import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { baseline, invoke } from "./launcher-fixture.mjs";

test("topology changes stop only deselected services in the selected project", () => {
  const dir = mkdtempSync(join(tmpdir(), "chalktalk-topology-switch-"));
  const project = "owned-transition-fixture";
  const active = join(dir, "active");
  const volumes = join(dir, "volumes");
  const calls = join(dir, "calls");
  writeFileSync(active, "other-project:postgres\nother-project:seaweedfs\n");
  writeFileSync(volumes, "other-project:postgres-data:other-volume\n");
  writeFileSync(
    join(dir, "docker"),
    `#!/bin/sh
project=
previous=
for arg do
  if [ "$previous" = --project-name ]; then project=$arg; fi
  previous=$arg
done
printf '%s|%s|%s\\n' "$project" "\${COMPOSE_FILE:-}" "$*" >> '${calls}'
case "$*" in
  *' up -d --wait postgres')
    grep -Fxq "$project:postgres" '${active}' || printf '%s\\n' "$project:postgres" >> '${active}'
    grep -Fq "$project:postgres-data:" '${volumes}' || printf '%s\\n' "$project:postgres-data:retained-db-volume" >> '${volumes}' ;;
  *' up -d --wait seaweedfs')
    grep -Fxq "$project:seaweedfs" '${active}' || printf '%s\\n' "$project:seaweedfs" >> '${active}'
    grep -Fq "$project:seaweedfs-data:" '${volumes}' || printf '%s\\n' "$project:seaweedfs-data:retained-store-volume" >> '${volumes}' ;;
  *' stop postgres') grep -Fxv "$project:postgres" '${active}' > '${active}.next'; mv '${active}.next' '${active}' ;;
  *' stop seaweedfs') grep -Fxv "$project:seaweedfs" '${active}' > '${active}.next'; mv '${active}.next' '${active}' ;;
esac
exit 0
`,
    { mode: 0o700 },
  );
  const run = (db, store, valid = true) => {
    const settings = {
      ...baseline,
      LOCAL_DATABASE_ENABLED: String(db),
      LOCAL_OBJECT_STORE_ENABLED: String(store),
      ...(db
        ? {}
        : {
            DATABASE_URL: "postgresql://fixture:secret@db.example.test/fixture",
          }),
      ...(store
        ? {}
        : {
            S3_ENDPOINT: "https://store.example.test",
            S3_BUCKET: "fixture",
            S3_REGION: "us-east-1",
            S3_ACCESS_KEY_ID: "fixture-key",
            S3_SECRET_ACCESS_KEY: "fixture-secret",
          }),
      ...(valid ? {} : { WEB_PORT: "0" }),
    };
    const envFile = join(dir, "operator.env");
    writeFileSync(
      envFile,
      Object.entries(settings)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") + "\n",
    );
    return spawnSync(
      "/bin/sh",
      [
        resolve("deployment/local/start.sh"),
        "--env-file",
        envFile,
        "--project-name",
        project,
      ],
      {
        encoding: "utf8",
        env: {
          PATH: `${dir}:/usr/bin:/bin`,
          HOME: dir,
          COMPOSE_FILE: "/hostile/override.yml",
          COMPOSE_PROJECT_NAME: "hostile-project",
        },
      },
    );
  };
  const inventory = () =>
    readFileSync(active, "utf8").trim().split("\n").sort();
  try {
    assert.equal(run(true, true).status, 0);
    assert.deepEqual(
      inventory(),
      [
        "other-project:postgres",
        "other-project:seaweedfs",
        `${project}:postgres`,
        `${project}:seaweedfs`,
      ].sort(),
    );
    const originalVolumes = readFileSync(volumes, "utf8");
    const beforeInvalid = readFileSync(calls, "utf8");
    assert.notEqual(run(false, false, false).status, 0);
    assert.equal(readFileSync(calls, "utf8"), beforeInvalid);
    assert.equal(run(false, false).status, 0);
    assert.deepEqual(inventory(), [
      "other-project:postgres",
      "other-project:seaweedfs",
    ]);
    assert.equal(readFileSync(volumes, "utf8"), originalVolumes);
    assert.equal(run(true, true).status, 0);
    assert.equal(run(false, true).status, 0);
    assert.deepEqual(
      inventory(),
      [
        "other-project:postgres",
        "other-project:seaweedfs",
        `${project}:seaweedfs`,
      ].sort(),
    );
    assert.equal(run(true, false).status, 0);
    assert.deepEqual(
      inventory(),
      [
        "other-project:postgres",
        "other-project:seaweedfs",
        `${project}:postgres`,
      ].sort(),
    );
    assert.equal(readFileSync(volumes, "utf8"), originalVolumes);
    const history = readFileSync(calls, "utf8");
    assert.doesNotMatch(history, /\|\/hostile\/override\.yml\|/);
    assert.doesNotMatch(history, /hostile-project|\bdown\b|volume rm/);
    assert.ok(
      history
        .split("\n")
        .filter(Boolean)
        .every((call) => call.startsWith(`${project}||`)),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
function verifyStartupFailure(failureMode) {
  const dir = mkdtempSync(join(tmpdir(), "chalktalk-partial-start-"));
  const project = "owned-partial-fixture";
  const active = join(dir, "active");
  const volumes = join(dir, "volumes");
  const calls = join(dir, "calls");
  writeFileSync(
    active,
    "other-project:api\nother-project:postgres\nowned-partial-fixture:postgres\nowned-partial-fixture:seaweedfs\n",
  );
  writeFileSync(
    volumes,
    "owned-partial-fixture:postgres-data:retained-db\nowned-partial-fixture:seaweedfs-data:retained-store\n",
  );
  writeFileSync(
    join(dir, "docker"),
    `#!/bin/sh
project=
previous=
for arg do
  if [ "$previous" = --project-name ]; then project=$arg; fi
  previous=$arg
done
printf '%s|%s|%s\n' "$project" "\${COMPOSE_FILE:-}" "$*" >> '${calls}'
case "$*" in
  *' stop gateway web api worker collaboration')
    grep -Ev "^$project:(gateway|web|api|worker|collaboration)$" '${active}' > '${active}.next'
    mv '${active}.next' '${active}' ;;
  *' up -d '*'api worker collaboration web gateway loki alloy node-exporter node-exporter-network prometheus grafana')
    printf '%s\n' "$project:api" "$project:worker" "$project:collaboration" >> '${active}'
    case '${failureMode}' in
      'partial startup') exit 1 ;;
      'late unhealthy gateway')
        case "$*" in *' --wait '*) exit 1 ;; esac ;;
    esac ;;
esac
exit 0
`,
    { mode: 0o700 },
  );
  const envFile = join(dir, "operator.env");
  writeFileSync(
    envFile,
    Object.entries(baseline)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
  try {
    const originalVolumes = readFileSync(volumes, "utf8");
    const result = spawnSync(
      "/bin/sh",
      [
        resolve("deployment/local/start.sh"),
        "--env-file",
        envFile,
        "--project-name",
        project,
      ],
      {
        encoding: "utf8",
        env: {
          PATH: `${dir}:/usr/bin:/bin`,
          HOME: dir,
          COMPOSE_FILE: "/hostile/override.yml",
          COMPOSE_PROJECT_NAME: "hostile-project",
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /application startup failed/);
    assert.match(
      readFileSync(calls, "utf8"),
      /up -d --wait --wait-timeout [0-9]+ api worker collaboration web gateway/,
    );
    assert.deepEqual(
      readFileSync(active, "utf8").trim().split("\n").sort(),
      [
        "other-project:api",
        "other-project:postgres",
        `${project}:postgres`,
        `${project}:seaweedfs`,
      ].sort(),
    );
    assert.equal(readFileSync(volumes, "utf8"), originalVolumes);
    const history = readFileSync(calls, "utf8").trim().split("\n");
    assert.equal(
      history.filter((call) =>
        call.endsWith(" stop gateway web api worker collaboration"),
      ).length,
      2,
    );
    assert.ok(history.every((call) => call.startsWith(`${project}||`)));
    assert.doesNotMatch(
      history.join("\n"),
      /hostile-project|\/hostile\/override\.yml|\bdown\b|volume rm|rm -v/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
for (const failureMode of ["partial startup", "late unhealthy gateway"])
  test(`${failureMode} gates applications and retains data`, () =>
    verifyStartupFailure(failureMode));
for (const db of [true, false])
  for (const store of [true, false]) {
    test(`starts topology database=${db}, store=${store} without host Node`, () => {
      const result = invoke({
        LOCAL_DATABASE_ENABLED: String(db),
        LOCAL_OBJECT_STORE_ENABLED: String(store),
        ...(!db
          ? {
              DATABASE_URL:
                "postgresql://fixture:password@db.example.test:5432/fixture",
            }
          : {}),
        ...(!store
          ? {
              S3_ENDPOINT: "https://store.example.test/path",
              S3_BUCKET: "fixture",
              S3_REGION: "us-east-1",
              S3_ACCESS_KEY_ID: "fixture-key",
              S3_SECRET_ACCESS_KEY: "fixture-secret",
            }
          : {}),
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.calls, /config/);
      assert.match(result.calls, /up/);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /synthetic-resend-key|fixture-secret/,
      );
    });
  }
const invalid = [
  ...["", "TRUE", "1", "yes"].map((value) => ["LOCAL_DATABASE_ENABLED", value]),
  ...[
    "DATABASE_URL",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_SESSION_TOKEN",
  ].map((key) => [key, "sentinel-sensitive-value"]),
  ...[
    "SENDGRID_API_KEY",
    "SES_REGION",
    "SES_CREDENTIALS_MODE",
    "SES_ACCESS_KEY_ID",
    "SES_SECRET_ACCESS_KEY",
    "SES_SESSION_TOKEN",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
  ].map((key) => [key, "sentinel-sensitive-value"]),
  ["EMAIL_PROVIDER", "smtp"],
  ["EMAIL_FROM", ""],
  ["RESEND_API_KEY", ""],
  ["PORT", "3000"],
  ["WEB_PORT", "0"],
  ["GRAFANA_PORT", "65536"],
  ["DOMAIN", "https://invalid.test"],
  ["LOCAL_DATABASE_HOST_PORT", "05123"],
  ["AUTH_TOKEN_SECRET", "replace-with-secret"],
];
for (const [key, value] of invalid)
  test(`rejects static ${key}=${JSON.stringify(value)} without mutations`, () => {
    const result = invoke({ [key]: value });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(key));
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /sentinel-sensitive-value|synthetic-resend-key/,
    );
    assert.equal(
      result.calls,
      "",
      "invalid static inputs must not reach Docker",
    );
  });
for (const suffix of [
  "export RESEND_API_KEY=value",
  'RESEND_API_KEY="quoted"',
  "RESEND_API_KEY=$(printf synthetic-key)",
  "RESEND_API_KEY=`id`",
  "RESEND_API_KEY=value\r",
  "RESEND_API_KEY=one\nRESEND_API_KEY=two",
  "not-an-assignment",
  "RESEND_API_KEY=trailing ",
]) {
  test(`rejects unsupported literal grammar ${JSON.stringify(suffix)}`, () => {
    const raw =
      Object.entries(baseline)
        .filter(([key]) => key !== "RESEND_API_KEY")
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") +
      "\n" +
      suffix +
      "\n";
    const result = invoke({}, { raw });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
    assert.doesNotMatch(result.stderr, /synthetic-resend-key/);
  });
}
for (const args of [
  ["--unknown"],
  ["--project-name", "one", "--project-name", "two"],
  ["--ack-external-migrations", "--ack-external-migrations"],
]) {
  test(`rejects CLI ${args.join(" ")}`, () => {
    const result = invoke({}, { args });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
  });
}

const connections = JSON.parse(
  readFileSync(new URL("./connection-fixtures.json", import.meta.url), "utf8"),
);
for (const fixture of connections)
  test(`shell connection contract: ${fixture.field} ${fixture.value}`, () => {
    const result = invoke(
      fixture.field === "DATABASE_URL"
        ? { LOCAL_DATABASE_ENABLED: "false", DATABASE_URL: fixture.value }
        : {
            LOCAL_OBJECT_STORE_ENABLED: "false",
            S3_ENDPOINT: fixture.value,
            S3_BUCKET: "fixture",
            S3_REGION: "us-east-1",
            S3_ACCESS_KEY_ID: "fixture",
            S3_SECRET_ACCESS_KEY: "fixture",
          },
    );
    assert.equal(result.status === 0, fixture.valid, result.stderr);
    if (!fixture.valid) {
      assert.equal(result.calls, "");
      assert.match(result.stderr, new RegExp(fixture.field));
      assert.ok(!result.stderr.includes(fixture.value));
    }
  });

for (const failure of ["runtime.ts check", "runtime.ts prepare"])
  test(`runtime failure ${failure} gates app traffic/workers without destructive cleanup`, () => {
    const result = invoke({}, { failure });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.calls, /up -d api|down|rm -v|volume rm/);
    if (failure === "runtime.ts check")
      assert.doesNotMatch(result.calls, /runtime.ts prepare/);
  });
for (const db of [true, false])
  for (const store of [true, false])
    test(`real Compose renders topology ${db}/${store} and stable named volumes`, () => {
      const result = invoke(
        {
          LOCAL_DATABASE_ENABLED: String(db),
          LOCAL_OBJECT_STORE_ENABLED: String(store),
          ...(!db
            ? {
                DATABASE_URL:
                  "postgresql://fixture:secret@db.example.test/fixture",
              }
            : {}),
          ...(!store
            ? {
                S3_ENDPOINT: "https://s3.example.test",
                S3_BUCKET: "fixture",
                S3_REGION: "us-east-1",
                S3_ACCESS_KEY_ID: "fixture",
                S3_SECRET_ACCESS_KEY: "fixture",
              }
            : {}),
        },
        {
          realRender: true,
          inherited: {
            COMPOSE_FILE: "/not/allowed.yml",
            COMPOSE_PROFILES: "evil",
            COMPOSE_PROJECT_NAME: "evil",
            COMPOSE_ENV_FILES: "/not/allowed.env",
          },
        },
      );
      assert.equal(result.status, 0, result.stderr + result.renderError);
      assert.ok(result.model, "real Compose must produce the model");
      assert.equal(result.model.name, "chalktalk");
      assert.equal(Boolean(result.model.services.postgres), db);
      assert.equal(Boolean(result.model.services.seaweedfs), store);
      if (db) assert.equal(result.model.services.postgres.ports, undefined);
      if (store) assert.equal(result.model.services.seaweedfs.ports, undefined);
      if (db)
        assert.equal(
          result.model.volumes["postgres-data"].name,
          "chalktalk_postgres-data",
        );
      assert.equal(
        result.model.volumes["caddy-data"].name,
        "chalktalk_caddy-data",
      );
      for (const service of ["api", "worker", "collaboration"]) {
        assert.equal(
          result.model.services[service].environment.LOCAL_DATABASE_ENABLED,
          undefined,
        );
        assert.equal(
          result.model.services[service].environment.LOCAL_DATABASE_PASSWORD,
          undefined,
        );
        assert.equal(
          result.model.services[service].environment.EMAIL_PROVIDER,
          "resend",
        );
      }
    });

for (const settings of [
  {
    EMAIL_PROVIDER: "sendgrid",
    RESEND_API_KEY: undefined,
    SENDGRID_API_KEY: "arbitrary-syntactic-key",
  },
  {
    EMAIL_PROVIDER: "ses",
    RESEND_API_KEY: undefined,
    SES_REGION: "us-east-1",
    SES_CREDENTIALS_MODE: "explicit",
    SES_ACCESS_KEY_ID: "arbitrary-key",
    SES_SECRET_ACCESS_KEY: "arbitrary-secret",
    SES_SESSION_TOKEN: "arbitrary-token",
  },
  {
    EMAIL_PROVIDER: "ses",
    RESEND_API_KEY: undefined,
    SES_REGION: "us-east-1",
    SES_CREDENTIALS_MODE: "default-chain",
    AWS_ACCESS_KEY_ID: "arbitrary-key",
    AWS_SECRET_ACCESS_KEY: "arbitrary-secret",
  },
])
  test(`static accepts ${settings.EMAIL_PROVIDER}/${settings.SES_CREDENTIALS_MODE ?? ""} without probing credentials`, () => {
    const result = invoke(settings, { realRender: true });
    assert.equal(result.status, 0, result.stderr + result.renderError);
    assert.equal(
      result.model.services.api.environment.EMAIL_PROVIDER,
      settings.EMAIL_PROVIDER,
    );
  });
test("file precedence and raw Compose env preserve literal #, spaces, and subsequent equals", () => {
  const key = "literal # not-an-inline-comment=a=b";
  const result = invoke(
    { RESEND_API_KEY: key },
    {
      realRender: true,
      inherited: { RESEND_API_KEY: "parent-value", EMAIL_PROVIDER: "sendgrid" },
    },
  );
  assert.equal(result.status, 0, result.stderr + result.renderError);
  assert.equal(result.model.services.api.environment.RESEND_API_KEY, key);
});
test("explicit project controls stable volume identities from another cwd", () => {
  const result = invoke(
    {},
    {
      realRender: true,
      args: ["--project-name", "owned-fixture"],
      inherited: { COMPOSE_PROJECT_NAME: "untrusted" },
    },
  );
  assert.equal(result.status, 0, result.stderr + result.renderError);
  assert.equal(result.model.name, "owned-fixture");
  assert.equal(
    result.model.volumes["caddy-data"].name,
    "owned-fixture_caddy-data",
  );
});
for (const settings of [
  { WEB_PORT: "3001" },
  {
    LOCAL_DATABASE_ENABLED: "false",
    DATABASE_URL: "postgresql://u:p@db.test/d",
    LOCAL_DATABASE_HOST_PORT: "5432",
  },
  { LOCAL_OBJECT_STORE_ENABLED: "false", LOCAL_OBJECT_STORE_HOST_PORT: "8333" },
  { LOCAL_DATABASE_HOST_PORT: "5432", LOCAL_OBJECT_STORE_HOST_PORT: "5432" },
])
  test(`rejects disabled/duplicate publications ${JSON.stringify(settings)}`, () => {
    const result = invoke(settings);
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
  });
test("optional data publications are loopback-only", () => {
  const result = invoke(
    {
      LOCAL_DATABASE_HOST_PORT: "15432",
      LOCAL_OBJECT_STORE_HOST_PORT: "18333",
    },
    { realRender: true },
  );
  assert.equal(result.status, 0, result.stderr + result.renderError);
  for (const service of ["postgres", "seaweedfs"])
    assert.equal(result.model.services[service].ports[0].host_ip, "127.0.0.1");
});
for (const [key, value] of [
  ["RESEND_API_KEY", "replace-with-a-resend-sending-key"],
  ["METRICS_TOKEN", ""],
  ["GRAFANA_ADMIN_PASSWORD", ""],
  ["AUTH_TOKEN_SECRET", ""],
  ["SES_CREDENTIALS_MODE", "bogus"],
  ["AWS_CONTAINER_CREDENTIALS_FULL_URI", "file:///sensitive-sentinel"],
  ["AWS_PROFILE", "bad profile"],
])
  test(`static rejects placeholder/source grammar ${key}`, () => {
    const result = invoke({ [key]: value });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
    assert.match(result.stderr, new RegExp(key));
    assert.doesNotMatch(result.stderr, /sensitive-sentinel/);
  });
const literals = JSON.parse(
  readFileSync(new URL("./literal-fixtures.json", import.meta.url), "utf8"),
);
for (const fixture of literals)
  test(`shell literal credential acceptance ${JSON.stringify(fixture.value)}`, () => {
    const result = invoke({ RESEND_API_KEY: fixture.value });
    assert.equal(result.status === 0, fixture.valid, result.stderr);
    if (!fixture.valid) assert.equal(result.calls, "");
  });

test("canonical template executes after replacing its explicit placeholders", () => {
  const raw = readFileSync(new URL("../.env.example", import.meta.url), "utf8")
    .replace(
      /^AUTH_TOKEN_SECRET=.*$/m,
      "AUTH_TOKEN_SECRET=synthetic-auth-secret-at-least-32-characters",
    )
    .replace(
      /^METRICS_TOKEN=.*$/m,
      "METRICS_TOKEN=synthetic-metrics-secret-at-least-32-characters",
    )
    .replace(
      /^GRAFANA_ADMIN_PASSWORD=.*$/m,
      "GRAFANA_ADMIN_PASSWORD=synthetic-grafana",
    )
    .replace(/^RESEND_API_KEY=.*$/m, "RESEND_API_KEY=synthetic-key");
  const result = invoke({}, { raw, realRender: true });
  assert.equal(result.status, 0, result.stderr + result.renderError);
});
for (const key of [
  "EMAIL_API_BASE_URL",
  "EMAIL_GATEWAY_URL",
  "SENDGRID_API_BASE_URL",
  "SES_ENDPOINT",
  "SES_ENDPOINT_URL",
  "AWS_ENDPOINT_URL",
  "AWS_ENDPOINT_URL_SES_V2",
])
  test(`rejects inherited legacy/custom mail selector ${key}`, () => {
    const result = invoke(
      {},
      { inherited: { [key]: "https://sensitive-sentinel.test" } },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(key));
    assert.doesNotMatch(result.stderr, /sensitive-sentinel/);
    assert.equal(result.calls, "");
  });
for (const fixture of JSON.parse(
  readFileSync(new URL("./sender-fixtures.json", import.meta.url), "utf8"),
))
  test(`shell sender acceptance ${fixture.value}`, () => {
    const result = invoke({ EMAIL_FROM: fixture.value });
    assert.equal(result.status === 0, fixture.valid, result.stderr);
    if (!fixture.valid) assert.equal(result.calls, "");
  });

test("acknowledgment cannot be granted by persistent configuration", () => {
  const result = invoke({ ACK_EXTERNAL_MIGRATIONS: "true" });
  assert.notEqual(result.status, 0);
  assert.equal(result.calls, "");
});
test("only explicitly selected credential files are mounted narrowly and read-only", () => {
  const source = "/tmp/owned-synthetic-aws-credentials";
  const result = invoke(
    {
      EMAIL_PROVIDER: "ses",
      RESEND_API_KEY: undefined,
      SES_REGION: "us-east-1",
      SES_CREDENTIALS_MODE: "default-chain",
      AWS_SHARED_CREDENTIALS_FILE: source,
    },
    { realRender: true },
  );
  assert.equal(result.status, 0, result.stderr + result.renderError);
  for (const service of ["migrate", "api", "worker"]) {
    const config = result.model.services[service];
    const mount = config.volumes.find(
      (item) =>
        item.target === "/run/chalktalk-aws/AWS_SHARED_CREDENTIALS_FILE",
    );
    assert.equal(mount.source, source);
    assert.equal(mount.read_only, true);
    assert.equal(mount.bind.create_host_path, false);
    assert.equal(config.environment.AWS_SHARED_CREDENTIALS_FILE, mount.target);
    assert.equal(config.environment.AWS_EC2_METADATA_DISABLED, "true");
    assert.notEqual(config.network_mode, "host");
  }
});
for (const suffix of ["\r", "# comment\r", "# comment\u0000"])
  test(`rejects controls anywhere in the env file ${JSON.stringify(suffix)}`, () => {
    const raw =
      Object.entries(baseline)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") +
      "\n" +
      suffix +
      "\n";
    const result = invoke({}, { raw });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
  });
for (const value of ["", "TRUE", "1", "yes"])
  test(`rejects object-store flag ${JSON.stringify(value)}`, () => {
    const result = invoke({ LOCAL_OBJECT_STORE_ENABLED: value });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /LOCAL_OBJECT_STORE_ENABLED/);
    assert.equal(result.calls, "");
  });
test("rejects duplicate env-file selection", () => {
  const result = invoke({}, { args: ["--env-file", "ignored.env"] });
  assert.notEqual(result.status, 0);
  assert.equal(result.calls, "");
});
for (const settings of [
  { RESEND_API_BASE_URL: "" },
  { EMBEDDING_API_KEY: "syntactic-key", EMBEDDING_BASE_URL: "" },
])
  test(`rejects explicit blank selected endpoint ${JSON.stringify(settings)}`, () => {
    const result = invoke(settings);
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
  });
for (const settings of [
  { AWS_SHARED_CREDENTIALS_FILE: "/tmp/unselected-host-profile" },
  {
    EMAIL_PROVIDER: "ses",
    RESEND_API_KEY: undefined,
    SES_REGION: "us-east-1",
    SES_CREDENTIALS_MODE: "explicit",
    SES_ACCESS_KEY_ID: "ses-key",
    SES_SECRET_ACCESS_KEY: "ses-secret",
    AWS_CONFIG_FILE: "/tmp/unselected-host-profile",
  },
])
  test(`generic unselected AWS sources do not become storage/provider conflicts ${JSON.stringify(settings)}`, () => {
    const result = invoke(settings, { realRender: true });
    assert.equal(result.status, 0, result.stderr + result.renderError);
    assert.ok(
      !result.model.services.api.volumes.some((mount) =>
        mount.target.startsWith("/run/chalktalk-aws/"),
      ),
    );
  });

test("malicious substitution never executes, even when its output would be valid credentials", () => {
  const result = invoke(
    {},
    {
      raw: (dir) =>
        Object.entries({
          ...baseline,
          EMAIL_FROM: "mail@example.test",
          RESEND_API_KEY: `$(touch ${dir}/probe; printf synthetic-key)`,
        })
          .map(([key, value]) => `${key}=${value}`)
          .join("\n") + "\n",
    },
  );
  assert.notEqual(result.status, 0);
  assert.equal(result.calls, "");
  assert.equal(result.probeCreated, false);
});
