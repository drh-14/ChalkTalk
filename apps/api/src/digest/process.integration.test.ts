import { spawn, type ChildProcess } from "node:child_process";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from "node:http";
import {
  createServer as createTcpServer,
  type Server as TcpServer,
} from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const schema = `digest_process_${process.pid}_${Date.now()}`;
const apiPath = fileURLToPath(new URL("../server.ts", import.meta.url));
const workerPath = fileURLToPath(new URL("../jobs/main.ts", import.meta.url));
const port = 30_000 + Math.floor(Math.random() * 20_000);
const courseId = uuidv7();
const recipientId = uuidv7();
let admin: Pool;
let pool: Pool;
let storage: HttpServer;
let smtp: TcpServer;
let storagePort: number;
let smtpPort: number;
const children: ChildProcess[] = [];
const messages: string[] = [];

function start(path: string): ChildProcess {
  const child = spawn(process.execPath, ["--import", "tsx", path], {
    env: {
      ...process.env,
      DATABASE_URL: `${databaseUrl}?options=-csearch_path%3D${schema}`,
      AUTH_TOKEN_SECRET: "test-secret-with-at-least-32-characters",
      PORT: String(port),
      S3_ENDPOINT: `http://127.0.0.1:${storagePort}`,
      S3_BUCKET: "digest-test",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "test-key",
      S3_SECRET_ACCESS_KEY: "test-secret",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtpPort),
      FRONTEND_ORIGINS: "https://example.edu",
      FRONTEND_BASE_URL: "https://example.edu",
    },
    stdio: "inherit",
  });
  children.push(child);
  return child;
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for digest process state");
}

integration("daily digest process separation", () => {
  beforeAll(async () => {
    storage = createHttpServer((request, response) => {
      if (request.method === "HEAD" && request.url === "/digest-test/")
        response.writeHead(200).end();
      else response.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      storage.listen(0, "127.0.0.1", resolve),
    );
    storagePort = (storage.address() as AddressInfo).port;

    smtp = createTcpServer((socket) => {
      socket.write("220 digest test SMTP\r\n");
      let pending = "";
      let message = "";
      let collecting = false;
      socket.on("data", (chunk: Buffer) => {
        pending += chunk.toString();
        while (pending.includes("\r\n")) {
          const end = pending.indexOf("\r\n");
          const line = pending.slice(0, end);
          pending = pending.slice(end + 2);
          if (collecting) {
            if (line === ".") {
              messages.push(message);
              message = "";
              collecting = false;
              socket.write("250 queued\r\n");
            } else message += `${line}\n`;
          } else if (line.startsWith("EHLO") || line.startsWith("HELO"))
            socket.write("250 digest test\r\n");
          else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO"))
            socket.write("250 OK\r\n");
          else if (line === "DATA") {
            collecting = true;
            socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          } else if (line === "QUIT") socket.end("221 Bye\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
    smtpPort = (smtp.address() as AddressInfo).port;

    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `--search_path=${schema}`,
    });
    await runMigrations(pool, getMigrationDirectory());
    const organizationId = uuidv7();
    const authorId = uuidv7();
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES($1,'digest.example.edu','Digest')",
      [organizationId],
    );
    await pool.query(
      `INSERT INTO users(id,organization_id,email,display_name,password_hash)
       VALUES($1,$3,'recipient@digest.example.edu','Recipient','x'),
             ($2,$3,'author@digest.example.edu','Author','x')`,
      [recipientId, authorId, organizationId],
    );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Digest course','ABCDEFGH')",
      [courseId, organizationId, authorId],
    );
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'student'),($1,$3,'student')",
      [courseId, recipientId, authorId],
    );
    await pool.query(
      `UPDATE digest_schedule_state SET last_scanned_date=((clock_timestamp() AT TIME ZONE 'UTC')::date - 2)`,
    );
    await pool.query(
      `INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at)
       VALUES($1,$2,$3,'note','Worker-owned digest note','Note body',
              ((clock_timestamp() AT TIME ZONE 'UTC')::date - 1)::timestamp AT TIME ZONE 'UTC' + interval '12 hours')`,
      [uuidv7(), courseId, authorId],
    );
  });

  afterAll(async () => {
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGTERM");
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
    await new Promise<void>((resolve) => storage?.close(() => resolve()));
    await new Promise<void>((resolve) => smtp?.close(() => resolve()));
  });

  it("leaves digest scheduling and delivery to the worker process", async () => {
    const api = start(apiPath);
    await waitFor(async () => {
      if (api.exitCode !== null) throw new Error("API process exited");
      try {
        return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
      } catch {
        return false;
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await pool.query("SELECT id FROM digest_outbox")).rowCount).toBe(0);
    expect(messages).toHaveLength(0);

    const worker = start(workerPath);
    await waitFor(async () => {
      if (worker.exitCode !== null) throw new Error("Worker process exited");
      const result = await pool.query<{ status: string }>(
        "SELECT status FROM digest_outbox WHERE recipient_user_id=$1 AND course_id=$2",
        [recipientId, courseId],
      );
      return result.rows[0]?.status === "sent";
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Worker-owned digest note");
    worker.kill("SIGTERM");
    await waitFor(async () => worker.exitCode !== null);
    expect(worker.exitCode).toBe(0);
  }, 120_000);
});
