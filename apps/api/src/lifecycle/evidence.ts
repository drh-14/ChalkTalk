import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, isAbsolute } from "node:path";
import type { DrainResult } from "./types.js";

export type BootIdentity = Readonly<{
  role: "api" | "collaboration" | "worker";
  bootId: string;
  releaseId: string;
  imageDigest: string;
}>;
type Options = Omit<BootIdentity, "bootId"> & {
  evidenceDirectory: string;
  requestDirectory: string;
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = 8192;

/** Directories are private, provisioned by the host, never created by a writer. */
export type EvidenceIO = Pick<typeof fs, "open" | "lstat" | "rename" | "rm">;

export function createEvidence(options: Options, io: EvidenceIO = fs) {
  if (
    !isAbsolute(options.evidenceDirectory) ||
    !isAbsolute(options.requestDirectory) ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(options.releaseId) ||
    !/^sha256:[a-f0-9]{64}$/.test(options.imageDigest) ||
    !["api", "collaboration", "worker"].includes(options.role)
  )
    throw new Error("Invalid lifecycle configuration");
  const identity: BootIdentity = Object.freeze({
    role: options.role,
    bootId: randomUUID(),
    releaseId: options.releaseId,
    imageDigest: options.imageDigest,
  });
  const bootStartedAt = new Date().toISOString();
  let requestRead: Promise<void> | undefined;
  let operationId: string | null = null;
  let requestNonce: string | null = null;
  let requestInvalid = false;
  let bootPublished = false;
  let terminalStarted = false;

  async function publish(name: string, value: object) {
    const directory = await io.open(
      options.evidenceDirectory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const finalPath = join(
      options.evidenceDirectory,
      `${identity.bootId}.${name}.json`,
    );
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
    // Exclusive reservation also prevents concurrent publication from overwriting
    // an existing receipt. Reservations are intentionally retained for this boot.
    let temporary: fs.FileHandle | undefined;
    try {
      const reservation = await io.open(`${finalPath}.reserved`, "wx", 0o600);
      await reservation.close();
      try {
        await io.lstat(finalPath);
        throw new Error("Lifecycle evidence already exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      temporary = await io.open(temporaryPath, "wx", 0o600);
      await temporary.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await temporary.sync();
      await temporary.close();
      temporary = undefined;
      await io.rename(temporaryPath, finalPath);
      await directory.sync();
    } finally {
      try {
        await temporary?.close();
      } finally {
        try {
          await io.rm(temporaryPath, { force: true });
        } finally {
          await directory.close();
        }
      }
    }
  }

  return {
    identity,
    async publishBoot() {
      await publish("boot", { schemaVersion: 1, ...identity, bootStartedAt });
      bootPublished = true;
    },
    readRequest(): Promise<void> {
      if (requestRead) return requestRead;
      requestRead = (async () => {
        let file: fs.FileHandle | undefined;
        try {
          const directory = await io.open(
            options.requestDirectory,
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
          );
          await directory.close();
          try {
            file = await io.open(
              join(options.requestDirectory, `${identity.bootId}.json`),
              constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
          }
          try {
            const info = await file.stat();
            if (
              !info.isFile() ||
              info.size > MAX_REQUEST_BYTES ||
              (info.mode & 0o077) !== 0
            )
              throw new Error();
            // A bounded read also protects against a concurrently growing file.
            const bytes = Buffer.alloc(MAX_REQUEST_BYTES + 1);
            const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
            if (bytesRead > MAX_REQUEST_BYTES) throw new Error();
            const request = JSON.parse(
              bytes.subarray(0, bytesRead).toString("utf8"),
            ) as Record<string, unknown>;
            const fields = [
              "schemaVersion",
              "role",
              "bootId",
              "releaseId",
              "imageDigest",
              "operationId",
              "requestNonce",
            ];
            if (
              !request ||
              typeof request !== "object" ||
              Array.isArray(request) ||
              Object.keys(request).length !== fields.length ||
              fields.some((field) => !(field in request)) ||
              request.schemaVersion !== 1 ||
              Object.entries(identity).some(
                ([key, value]) => request[key] !== value,
              ) ||
              typeof request.operationId !== "string" ||
              !UUID.test(request.operationId) ||
              typeof request.requestNonce !== "string" ||
              !UUID.test(request.requestNonce)
            )
              throw new Error();
            operationId = request.operationId;
            requestNonce = request.requestNonce;
          } finally {
            await file.close();
          }
        } catch {
          requestInvalid = true;
          throw new Error("Invalid lifecycle request");
        }
      })();
      return requestRead;
    },
    async publishTerminal(result: DrainResult) {
      if (!bootPublished || !requestRead || terminalStarted)
        throw new Error("Lifecycle evidence not publishable");
      await requestRead;
      if (requestInvalid) throw new Error("Invalid lifecycle request");
      if (
        result.result === "success" &&
        (result.exitCode !== 0 ||
          result.failures.length > 0 ||
          Object.values(result.remaining).some((count) => count !== 0) ||
          result.elapsedMs >= result.deadlineMs)
      ) {
        throw new Error("Invalid lifecycle success evidence");
      }
      terminalStarted = true;
      await publish("terminal", {
        schemaVersion: 1,
        ...identity,
        bootStartedAt,
        operationId,
        requestNonce,
        trigger: result.trigger,
        cutoffAt: result.cutoffAt,
        completedAt: result.completedAt,
        deadlineMs: result.deadlineMs,
        elapsedMs: Math.floor(result.elapsedMs),
        result: result.result,
        exitCode: result.exitCode,
        remaining: {
          activeAdmissions:
            result.remaining.admission + result.remaining.startup,
          handlers: result.remaining.handler,
          stores: result.remaining.store,
          jobs: result.remaining.job,
          heartbeats: result.remaining.heartbeat,
          children: result.remaining.child,
          listeners: result.remaining.listener,
          unresolved: result.failures.length,
        },
        failures: result.failures,
      });
    },
  };
}
