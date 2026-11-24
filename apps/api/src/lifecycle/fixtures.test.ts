import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createEvidence, type BootIdentity } from "./evidence.js";
import type { DrainResult } from "./types.js";
import fixtures from "../../../../tests/fixtures/lifecycle-replacement-evidence.json";

it.each(fixtures.instances)(
  "producer matches the synthetic $boot.role consumer wire fixture",
  async (fixture) => {
    const directory = await mkdtemp(join(tmpdir(), "chalktalk-wire-"));
    try {
      const evidence = createEvidence({
        role: fixture.boot.role as BootIdentity["role"],
        releaseId: fixture.boot.releaseId,
        imageDigest: fixture.boot.imageDigest,
        evidenceDirectory: directory,
        requestDirectory: directory,
      });
      await evidence.publishBoot();
      const boot = JSON.parse(
        await readFile(
          join(directory, `${evidence.identity.bootId}.boot.json`),
          "utf8",
        ),
      );
      expect(boot).toEqual({
        ...fixture.boot,
        bootId: evidence.identity.bootId,
        bootStartedAt: boot.bootStartedAt,
      });
      await writeFile(
        join(directory, `${evidence.identity.bootId}.json`),
        JSON.stringify({
          ...fixture.request,
          bootId: evidence.identity.bootId,
        }),
        { mode: 0o600 },
      );
      await evidence.readRequest();
      const result: DrainResult = {
        trigger: "SIGTERM",
        result: "success",
        exitCode: 0,
        deadlineMs: fixture.terminal.deadlineMs,
        elapsedMs: fixture.terminal.elapsedMs,
        cutoffAt: fixture.terminal.cutoffAt,
        completedAt: fixture.terminal.completedAt,
        remaining: {
          startup: 0,
          admission: 0,
          handler: 0,
          store: 0,
          job: 0,
          heartbeat: 0,
          child: 0,
          listener: 0,
        },
        failures: [],
      };
      await evidence.publishTerminal(result);
      const terminal = JSON.parse(
        await readFile(
          join(directory, `${evidence.identity.bootId}.terminal.json`),
          "utf8",
        ),
      );
      expect(terminal).toEqual({
        ...fixture.terminal,
        bootId: evidence.identity.bootId,
        bootStartedAt: boot.bootStartedAt,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
