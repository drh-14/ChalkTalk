import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { createEvidence, type EvidenceIO } from "./evidence.js";
import { createLifecycle } from "./runtime.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

it.each(["create", "write", "file-sync", "rename", "directory-sync", "close"])(
  "fails drain on terminal %s failure",
  async (phase) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "chalktalk-fault-"));
    directories.push(directory);
    let enabled = false;
    const error = () => {
      throw new Error("private SQL password object key");
    };
    const io: EvidenceIO = {
      ...fs,
      rename: async (...args) => {
        if (enabled && phase === "rename") error();
        return fs.rename(...args);
      },
      open: async (...args) => {
        const isDirectory = args[0] === directory;
        if (enabled && phase === "create" && !isDirectory) error();
        const handle = await fs.open(...args);
        return new Proxy(handle, {
          get(target, key) {
            if (key === "writeFile")
              return async (
                ...input: Parameters<fs.FileHandle["writeFile"]>
              ) => {
                if (enabled && phase === "write") error();
                return target.writeFile(...input);
              };
            if (key === "sync")
              return async () => {
                if (
                  enabled &&
                  phase === (isDirectory ? "directory-sync" : "file-sync")
                )
                  error();
                return target.sync();
              };
            if (key === "close")
              return async () => {
                await target.close();
                if (enabled && phase === "close") error();
              };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };
    const evidence = createEvidence(
      {
        role: "worker",
        releaseId: "c".repeat(40),
        imageDigest: `sha256:${"d".repeat(64)}`,
        requestDirectory: directory,
        evidenceDirectory: directory,
      },
      io,
    );
    await evidence.publishBoot();
    await evidence.readRequest();
    enabled = true;
    let exitCode: number | undefined;
    const runtime = createLifecycle({
      publish: evidence.publishTerminal,
      exit: (code) => {
        exitCode = code;
      },
    });
    const result = await runtime.shutdown("SIGTERM");
    expect(result.result).toBe("failure");
    expect(result.failures).toEqual(["evidence_failed"]);
    expect(exitCode).toBe(1);
    if (phase === "directory-sync") {
      // A visible success receipt is insufficient; consumer MUST also observe exit 0.
      const visible = JSON.parse(
        await fs.readFile(
          join(directory, `${evidence.identity.bootId}.terminal.json`),
          "utf8",
        ),
      );
      expect(visible.result).toBe("success");
    }
    expect(JSON.stringify(result)).not.toContain("password");
  },
);
