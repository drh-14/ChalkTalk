import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateProductionTarget,
  validateRunId,
  fixtureIdentity,
} from "./load-test-fixture.js";

const url =
  "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";

describe("privileged load-test fixture guard", () => {
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
