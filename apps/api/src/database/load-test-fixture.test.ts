import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireFixtureClient,
  validateProductionTarget,
  validateRunId,
  fixtureIdentity,
  validateManifest,
} from "./load-test-fixture.js";

const url =
  "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";

describe("privileged load-test fixture guard", () => {
  it("marks only pre-transaction connection exhaustion as retryable", async () => {
    const exhausted = {
      connect: async () => {
        throw new Error(
          "(EMAXCONNSESSION) max clients reached in session mode",
        );
      },
    };
    await expect(acquireFixtureClient(exhausted as never)).rejects.toThrow(
      "CONNECTION_ACQUISITION_EXHAUSTED",
    );
    const other = {
      connect: async () => {
        throw new Error("connection lost after commit");
      },
    };
    await expect(acquireFixtureClient(other as never)).rejects.toThrow(
      "connection lost after commit",
    );
  });
  it("requires the exact project reference, host, database, and verified TLS before a connection", () => {
    expect(() =>
      validateProductionTarget(
        url,
        "abcdefghijklmnopqrst",
        "aws-0-us-east-1.pooler.supabase.com",
      ),
    ).not.toThrow();
    for (const [changed, ref, host] of [
      [url, "otherprojectref12345", "aws-0-us-east-1.pooler.supabase.com"],
      [url, "abcdefghijklmnopqrst", "other.pooler.supabase.com"],
      [
        url.replace("/postgres?", "/other?"),
        "abcdefghijklmnopqrst",
        "aws-0-us-east-1.pooler.supabase.com",
      ],
      [
        url.replace("verify-full", "require"),
        "abcdefghijklmnopqrst",
        "aws-0-us-east-1.pooler.supabase.com",
      ],
      [
        url.replace(
          "postgres.abcdefghijklmnopqrst",
          "postgres.otherprojectref12345",
        ),
        "abcdefghijklmnopqrst",
        "aws-0-us-east-1.pooler.supabase.com",
      ],
    ] as const)
      expect(() => validateProductionTarget(changed, ref, host)).toThrow();
  });

  it("refuses ambiguous run IDs and generates a unique reserved namespace", () => {
    expect(() => validateRunId("load-20261117-a1b2c3d4")).not.toThrow();
    for (const id of ["prod", "../../prod", "UPPERCASE99", "x".repeat(65)])
      expect(() => validateRunId(id)).toThrow();
    const identity = fixtureIdentity("load-20261117-a1b2c3d4");
    expect(identity.domain).toBe("load-20261117-a1b2c3d4.loadtest.invalid");
    expect(identity.courseName).toContain("load-20261117-a1b2c3d4");
  });

  it("validates exact three-course Ramp cohorts and rejects cross-course users", () => {
    const runId = "load-20261117-a1b2c3d4";
    const sha = "a".repeat(40);
    const courseIds = ["1", "2", "3"].map(
      (digit) =>
        `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`,
    );
    const uuid = (n: number) =>
      `${String(n).padStart(8, "0")}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;
    const manifest = {
      runId,
      deployedSha: sha,
      baseUrl: "https://joinchalktalk.com",
      expectedProjectRef: "abcdefghijklmnopqrst",
      expectedHost: "aws-0-us-east-1.pooler.supabase.com",
      organizationId: "4".repeat(8) + "-4444-4444-4444-444444444444",
      mode: "ramp",
      courseId: courseIds[0],
      questionId: uuid(1),
      pollId: uuid(2),
      pollOptionId: uuid(3),
      courses: courseIds.map((id, index) => ({
        id,
        questionId: uuid(index * 10 + 1),
        pollId: uuid(index * 10 + 2),
        pollOptionId: uuid(index * 10 + 3),
        boardId: uuid(index * 10 + 4),
        resourceId: uuid(index * 10 + 5),
      })),
      users: Array.from({ length: 30 }, (_, i) => ({
        id: uuid(i + 100),
        email: `vu${String(i + 1).padStart(2, "0")}@${fixtureIdentity(runId).domain}`,
        password: `private-${i}`,
        courseId: courseIds[i % 3],
        role: i < 3 ? "instructor" : "student",
      })),
    };
    expect(() => validateManifest(manifest as never, runId, sha)).not.toThrow();
    expect(() =>
      validateManifest(
        {
          ...manifest,
          users: [
            { ...manifest.users[0]!, courseId: "foreign" },
            ...manifest.users.slice(1),
          ],
        } as never,
        runId,
        sha,
      ),
    ).toThrow();
  });

  it("CLI refuses a world-readable URL and wrong project before any database connection", () => {
    const directory = mkdtempSync(join(tmpdir(), "chalktalk-k6-cli-"));
    const dbFile = join(directory, "db-url");
    const shaFile = join(directory, "deployed.sha");
    const sha = "a".repeat(40);
    writeFileSync(shaFile, sha);
    writeFileSync(dbFile, url);
    const args = [
      "--import",
      "tsx",
      "apps/api/src/database/load-test-fixture-cli.ts",
      "provision",
      "--confirm-production",
      "joinchalktalk.com",
      "--expected-project-ref",
      "abcdefghijklmnopqrst",
      "--expected-host",
      "aws-0-us-east-1.pooler.supabase.com",
      "--run-id",
      "load-20261117-a1b2c3d4",
      "--deployed-sha",
      sha,
      "--deployed-sha-file",
      shaFile,
      "--db-url-file",
      dbFile,
      "--manifest",
      join(directory, "manifest.json"),
    ];
    try {
      chmodSync(dbFile, 0o644);
      const insecure = spawnSync(process.execPath, args, {
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: url },
      });
      expect(insecure.status).toBe(1);
      expect(insecure.stderr).toContain("owner-only file");
      chmodSync(dbFile, 0o600);
      writeFileSync(
        dbFile,
        url.replace(
          "postgres.abcdefghijklmnopqrst",
          "postgres.zyxwvutsrqponmlkjihg",
        ),
      );
      const wrongProject = spawnSync(process.execPath, args, {
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: url },
      });
      expect(wrongProject.status).toBe(1);
      expect(wrongProject.stderr).toContain("project reference mismatch");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
