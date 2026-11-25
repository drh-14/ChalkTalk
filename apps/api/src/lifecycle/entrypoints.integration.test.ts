import { fork, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, connect } from "node:net";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
const database = process.env.TEST_DATABASE_URL;
const test = database ? it : it.skip;

test.each(["api", "worker", "collaboration"])(
  "actual %s entrypoint settles startup after repeated signals and publishes a bound receipt",
  async (role) => {
    const directory = await mkdtemp(join(tmpdir(), "chalktalk-entrypoint-"));
    let unblock!: () => void;
    const gate = new Promise<void>((done) => {
      unblock = done;
    });
    let entered!: () => void;
    const admission = new Promise<void>((done) => {
      entered = done;
    });
    const s3 = createHttpServer((_request, response) => {
      entered();
      void gate.then(() => response.writeHead(200).end());
    });
    const sockets = new Set<import("node:net").Socket>();
    const target = new URL(database!);
    const proxy = createTcpServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.pause();
      entered();
      void gate.then(() => {
        const backend = connect(Number(target.port || 5432), target.hostname);
        sockets.add(backend);
        backend.on("error", () => socket.destroy());
        socket.pipe(backend);
        backend.pipe(socket);
        socket.resume();
      });
    });
    s3.listen(0, "127.0.0.1");
    proxy.listen(0, "127.0.0.1");
    await Promise.all([once(s3, "listening"), once(proxy, "listening")]);
    const proxied = new URL(database!);
    proxied.port = String((proxy.address() as { port: number }).port);
    const portReservation = createTcpServer();
    portReservation.listen(0, "127.0.0.1");
    await once(portReservation, "listening");
    const applicationPort = String(
      (portReservation.address() as { port: number }).port,
    );
    await new Promise<void>((done) => portReservation.close(() => done()));
    let child: ChildProcess | undefined;
    let stderr = "";
    try {
      const entrypoint =
        role === "api"
          ? "../server.ts"
          : role === "worker"
            ? "../jobs/main.ts"
            : "../collaboration/main.ts";
      child = fork(fileURLToPath(new URL(entrypoint, import.meta.url)), [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: applicationPort,
          COLLABORATION_PORT: applicationPort,
          DATABASE_URL:
            role === "collaboration" ? proxied.toString() : database,
          AUTH_TOKEN_SECRET:
            "entrypoint-lifecycle-test-only-secret-at-least-32-characters",
          EMAIL_PROVIDER: "smtp",
          S3_ENDPOINT: `http://127.0.0.1:${(s3.address() as { port: number }).port}`,
          S3_BUCKET: "test",
          S3_REGION: "us-east-1",
          S3_ACCESS_KEY_ID: "test",
          S3_SECRET_ACCESS_KEY: "test",
          LIFECYCLE_EVIDENCE_DIRECTORY: directory,
          LIFECYCLE_REQUEST_DIRECTORY: directory,
          LIFECYCLE_RELEASE_ID: "entrypoint-test",
          LIFECYCLE_IMAGE_DIGEST: `sha256:${"e".repeat(64)}`,
        },
      });
      child.stderr!.on("data", (value) => {
        stderr += String(value);
      });
      const exited = new Promise<number | null>((done) =>
        child!.once("exit", done),
      );
      await Promise.race([
        admission,
        exited.then((code) => {
          throw new Error(`Early exit ${code}: ${stderr}`);
        }),
      ]);
      const bootName = (await readdir(directory)).find((name) =>
        name.endsWith(".boot.json"),
      )!;
      const boot = JSON.parse(
        await readFile(join(directory, bootName), "utf8"),
      );
      const identity = {
        schemaVersion: boot.schemaVersion,
        role: boot.role,
        bootId: boot.bootId,
        releaseId: boot.releaseId,
        imageDigest: boot.imageDigest,
      };
      const operationId = randomUUID(),
        requestNonce = randomUUID();
      await writeFile(
        join(directory, `${boot.bootId}.json`),
        JSON.stringify({ ...identity, operationId, requestNonce }),
        { mode: 0o600 },
      );
      child.kill("SIGTERM");
      // Give the OS signal callback a turn while startup remains deliberately held.
      await new Promise((done) => setTimeout(done, 30));
      child.kill("SIGINT");
      unblock();
      expect(await exited, stderr).toBe(0);
      const receipt = JSON.parse(
        await readFile(join(directory, `${boot.bootId}.terminal.json`), "utf8"),
      );
      expect(receipt).toMatchObject({
        role,
        operationId,
        requestNonce,
        result: "success",
        exitCode: 0,
        deadlineMs: 120000,
      });
      expect(Object.values(receipt.remaining)).toEqual([
        0, 0, 0, 0, 0, 0, 0, 0,
      ]);
    } finally {
      unblock();
      if (child?.exitCode === null) child.kill("SIGKILL");
      for (const socket of sockets) socket.destroy();
      s3.closeAllConnections();
      await Promise.all([
        new Promise<void>((done) => s3.close(() => done())),
        new Promise<void>((done) => proxy.close(() => done())),
      ]);
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);
