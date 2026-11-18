/* global process */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { sanitizeArtifacts } from "./sanitize-artifacts.mjs";

const integration = process.env.RUN_K6_INTEGRATION === "1" ? test : test.skip;
const sourcePath = resolve(import.meta.dirname, "workload.js");

async function exercise(rateLimit, ambiguousMutation = false, mode = "smoke") {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      path: request.url,
      headers: request.headers,
      body,
    });
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/sessions") {
      response.statusCode = 201;
      response.setHeader(
        "set-cookie",
        "__Host-chalktalk_session=fake; Path=/; SameSite=Lax",
      );
      response.end(JSON.stringify({ data: { csrfToken: "fake-csrf" } }));
    } else if (
      !request.headers.cookie?.includes("__Host-chalktalk_session=fake")
    ) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: "unauthorized" }));
    } else if (rateLimit && request.url === "/api/v1/courses") {
      response.statusCode = 429;
      response.end(JSON.stringify({ error: "rate_limited" }));
    } else if (ambiguousMutation && request.method === "PUT") {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response.statusCode = 200;
      response.end(JSON.stringify({ data: {} }));
    } else if (
      request.method === "POST" &&
      /\/courses\/[^/]+\/posts$|\/posts\/[^/]+\/(answers|followups)$/.test(
        request.url,
      )
    ) {
      response.statusCode = 201;
      response.end(
        JSON.stringify({
          data: {
            id: randomUUID(),
            options: [{ id: randomUUID() }, { id: randomUUID() }],
          },
        }),
      );
    } else {
      response.statusCode = 200;
      response.end(JSON.stringify({ data: {} }));
    }
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const directory = await mkdtemp(
    resolve(import.meta.dirname, ".workload-test-"),
  );
  // This disposable test data must be readable by k6's non-root Docker user.
  await chmod(directory, 0o755);
  try {
    const target = `http://host.docker.internal:${server.address().port}`;
    const source = (await readFile(sourcePath, "utf8"))
      .replace(
        'const BASE_URL = "https://joinchalktalk.com";',
        `const BASE_URL = "${target}";`,
      )
      .replace(
        'duration: "2m"',
        process.env.K6_TEST_REMOTE_WRITE_URL
          ? 'duration: "15s"'
          : 'duration: "8s"',
      )
      .replace("sleep(2);", "sleep(1);");
    const rampSource =
      mode === "ramp"
        ? source
            .replaceAll(
              /duration: `\$\{profile\.stageMinutes\[\d\]\}m`/g,
              'duration: "5s"',
            )
            .replace(
              "const WRITE_INTERVAL_MS = 30000;",
              "const WRITE_INTERVAL_MS = 1000;",
            )
        : source;
    const instrumentedSource = ambiguousMutation
      ? rampSource
          .replace(
            "const WRITE_INTERVAL_MS = 30000;",
            "const WRITE_INTERVAL_MS = 1000;",
          )
          .replace('timeout: "10s"', 'timeout: "1s"')
      : rampSource;
    await writeFile(join(directory, "workload.js"), instrumentedSource);
    await chmod(join(directory, "workload.js"), 0o644);
    const manifest = {
      runId: `load-20261117-${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      deployedSha: "a".repeat(40),
      baseUrl: target,
      courseId: randomUUID(),
      questionId: randomUUID(),
      pollId: randomUUID(),
      pollOptionId: randomUUID(),
      users: Array.from({ length: 20 }, (_, i) => ({
        email: `vu${i}@example.invalid`,
        password: "synthetic-private-password-not-in-k6-report",
      })),
    };
    await writeFile(
      join(directory, "profile.json"),
      JSON.stringify(
        mode === "ramp"
          ? {
              maxVus: 2,
              stageMinutes: [1, 3, 3, 3],
              stageTargets: [2, 2, 2, 2],
              rampWriteAttempts: 17,
            }
          : {
              maxVus: 1,
              stageMinutes: [1, 3, 3, 3],
              stageTargets: [1, 1, 1, 1],
              rampWriteAttempts: 17,
            },
      ),
    );
    await chmod(join(directory, "profile.json"), 0o644);
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    await chmod(join(directory, "manifest.json"), 0o644);
    const args = [
      "run",
      "--rm",
      "--user",
      `${process.getuid()}:${process.getgid()}`,
      "--add-host=host.docker.internal:host-gateway",
      "-v",
      `${directory}:/test`,
      ...(process.env.K6_TEST_REMOTE_WRITE_URL
        ? [
            "-e",
            `K6_PROMETHEUS_RW_SERVER_URL=${process.env.K6_TEST_REMOTE_WRITE_URL}`,
            "-e",
            "K6_PROMETHEUS_RW_TREND_STATS=p(50),p(90),p(95),p(99)",
          ]
        : []),
      "-e",
      "K6_WEB_DASHBOARD=true",
      "-e",
      `K6_WEB_DASHBOARD_EXPORT=/test/${manifest.runId}-${mode}.html`,
      "grafana/k6:2.4.0",
      "run",
      ...(process.env.K6_TEST_REMOTE_WRITE_URL
        ? ["-o", "experimental-prometheus-rw"]
        : []),
      "-e",
      "MANIFEST_PATH=/test/manifest.json",
      "-e",
      "PROFILE_PATH=/test/profile.json",
      "-e",
      `MODE=${mode}`,
      "-e",
      `RUN_ID=${manifest.runId}`,
      "-e",
      `DEPLOYED_SHA=${manifest.deployedSha}`,
      "-e",
      "CONFIRM_PRODUCTION=joinchalktalk.com",
      "-e",
      "REPORT_DIR=/test",
      "/test/workload.js",
    ];
    const output = await new Promise((resolve, reject) => {
      const child = spawn("docker", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      child.stdout.on("data", (chunk) => {
        text += chunk;
      });
      child.stderr.on("data", (chunk) => {
        text += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, text }));
    });
    const summaryPath = join(
      directory,
      `${manifest.runId}-${mode}-summary.json`,
    );
    const summary =
      output.code === 0
        ? JSON.parse(await readFile(summaryPath, "utf8"))
        : null;
    if (output.code === 0) {
      await writeFile(
        join(directory, "window.json"),
        JSON.stringify({
          start: "2026-11-17T15:00:00Z",
          end: "2026-11-17T15:01:00Z",
        }),
      );
      const sanitized = join(directory, "sanitized");
      sanitizeArtifacts(
        manifest,
        directory,
        sanitized,
        manifest.runId,
        mode,
        "https://github.com/drh-14/ChalkTalk/actions/runs/44156607166",
      );
      assert.ok((await stat(join(sanitized, "summary.json"))).size > 1000);
      if (mode === "ramp")
        assert.ok((await stat(join(sanitized, "report.html"))).size > 1000);
    }
    return { requests, output, summary };
  } finally {
    server.close();
    await rm(directory, { force: true, recursive: true });
  }
}

integration(
  "k6 smoke signs in once, uses cookie/CSRF/Origin, and performs only isolated reads and one vote",
  async () => {
    const { requests, output, summary } = await exercise(false);
    assert.equal(output.code, 0, output.text);
    for (const operation of [
      "login",
      "list_courses",
      "list_posts",
      "read_post",
      "list_notifications",
      "unread_count",
      "smoke_vote",
    ])
      assert.ok(
        summary.metrics[`op_${operation}_success`]?.values.count >= 1,
        `${operation}: ${Object.keys(summary.metrics).join(",")}`,
      );
    assert.equal(
      requests.filter((r) => r.path === "/api/v1/sessions").length,
      1,
    );
    assert.ok(requests.filter((r) => r.path === "/api/v1/courses").length >= 2);
    const vote = requests.filter((r) => r.method === "PUT");
    assert.equal(vote.length, 1);
    assert.match(vote[0].path, /^\/api\/v1\/posts\/[a-f0-9-]+\/vote$/);
    assert.match(
      vote[0].headers.origin,
      /^http:\/\/host\.docker\.internal:\d+$/,
    );
    assert.equal(vote[0].headers["x-csrf-token"], "fake-csrf");
    assert.match(vote[0].headers.cookie, /__Host-chalktalk_session=fake/);
  },
);

integration(
  "ramp obtains successful checks for every selected read and write within the bounded attempts",
  async () => {
    const { requests, output, summary } = await exercise(false, false, "ramp");
    assert.equal(output.code, 0, output.text);
    for (const operation of [
      "login",
      "list_courses",
      "list_posts",
      "read_post",
      "list_notifications",
      "unread_count",
      "create_question",
      "create_note",
      "create_answer",
      "create_followup",
      "create_poll",
      "vote",
    ])
      assert.ok(
        summary.metrics[`op_${operation}_success`]?.values.count >= 1,
        operation,
      );
    const writes =
      requests.filter(
        (r) => r.method === "POST" && r.path !== "/api/v1/sessions",
      ).length + requests.filter((r) => r.method === "PUT").length;
    assert.ok(writes >= 6 && writes <= 17);
  },
);

integration(
  "k6 stops on a 429 instead of treating it as saturation",
  async () => {
    const { output, requests } = await exercise(true);
    assert.notEqual(output.code, 0);
    assert.match(output.text, /Rate limit encountered|rate_limit_hits/);
    assert.ok(requests.some((r) => r.path === "/api/v1/courses"));
  },
);

integration(
  "k6 does not retry a committed-but-timed-out mutation",
  async () => {
    const { output, requests } = await exercise(false, true);
    assert.notEqual(output.code, 0, output.text);
    assert.match(
      output.text,
      /smoke_vote: unexpected status 0|network failure/,
    );
    assert.equal(requests.filter((r) => r.method === "PUT").length, 1);
  },
);
