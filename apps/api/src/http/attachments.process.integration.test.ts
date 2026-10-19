import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import { Pool } from "pg";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { zipSync, strToU8 } from "fflate";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";

const url = process.env.TEST_DATABASE_URL;
const endpoint = process.env.TEST_S3_ENDPOINT;
const integration = url && endpoint ? describe : describe.skip;
const schema = `attachment_process_${process.pid}_${Date.now()}`;
const bucket = `attachment-process-${process.pid}-${Date.now()}`;
const origin = "https://attachments.example.edu";
const userId = uuidv7(),
  courseId = uuidv7(),
  organizationId = uuidv7();
const password = "attachment process test password";
const s3 = new S3Client({
  region: "us-east-1",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "chalktalk-local",
    secretAccessKey:
      process.env.TEST_S3_SECRET_ACCESS_KEY ?? "chalktalk-local-secret",
  },
});
let admin: Pool;
let pool: Pool;
let apiBase: string;
let environment: NodeJS.ProcessEnv;
let bucketCreated = false;
const children: ChildProcess[] = [];
const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082",
  "hex",
);
function office(kind: "word" | "ppt") {
  const doc = kind === "word";
  const part = doc ? "word/document.xml" : "ppt/presentation.xml";
  const type = doc
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    : "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${part}" ContentType="${type}"/></Types>`,
      ),
      "_rels/.rels": strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${part}"/></Relationships>`,
      ),
      [part]: strToU8(
        doc
          ? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>API smoke document</w:t></w:r></w:p></w:body></w:document>'
          : '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
      ),
    }),
  );
}
const files = [
  { name: "diagram.png", type: "image/png", bytes: png },
  {
    name: "notes.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: office("word"),
  },
  {
    name: "slides.pptx",
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes: office("ppt"),
  },
];
async function waitFor(condition: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for attachment smoke process");
}
function start(relative: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", fileURLToPath(new URL(relative, import.meta.url))],
    { env: environment, stdio: "ignore" },
  );
  children.push(child);
  return child;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}
integration("authenticated attachment API and separate cleanup process", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path=${schema}`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketCreated = true;
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'attachments.example.edu','Attachments smoke')",
      [organizationId],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'smoke@attachments.example.edu','Smoke instructor',$3)",
      [userId, organizationId, await argon2.hash(password)],
    );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Attachment smoke','ABCDEFGH')",
      [courseId, organizationId, userId],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor')",
      [courseId, userId],
    );
    const listener = createServer();
    await new Promise<void>((resolve) =>
      listener.listen(0, "127.0.0.1", resolve),
    );
    const address = listener.address();
    if (!address || typeof address === "string")
      throw new Error("Test listener has no port");
    const port = address.port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    apiBase = `http://127.0.0.1:${port}`;
    const database = new URL(url!);
    database.searchParams.set("options", `-csearch_path=${schema}`);
    environment = {
      ...process.env,
      DATABASE_URL: database.toString(),
      PORT: String(port),
      AUTH_TOKEN_SECRET:
        "attachment-smoke-secret-longer-than-thirty-two-characters",
      FRONTEND_ORIGINS: origin,
      FRONTEND_BASE_URL: origin,
      OBSERVABILITY_ENABLED: "false",
      S3_ENDPOINT: endpoint,
      S3_BUCKET: bucket,
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID ?? "chalktalk-local",
      S3_SECRET_ACCESS_KEY:
        process.env.TEST_S3_SECRET_ACCESS_KEY ?? "chalktalk-local-secret",
    };
    const api = start("../server.ts");
    await waitFor(async () => {
      if (api.exitCode !== null) throw new Error("Attachment API exited");
      try {
        return (await fetch(`${apiBase}/health`)).ok;
      } catch {
        return false;
      }
    });
  }, 15000);
  afterAll(async () => {
    for (const child of children) await stop(child);
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (bucketCreated) {
      const objects = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket }),
      );
      for (const object of objects.Contents ?? [])
        if (object.Key)
          await s3.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
          );
      await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
    s3.destroy();
  });
  it("logs in, round trips PNG/DOCX/PPTX, replays uploads, rejects a disguised image, and cleans only in the worker", async () => {
    const login = await fetch(`${apiBase}/api/v1/sessions`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "smoke@attachments.example.edu",
        password,
      }),
    });
    expect(login.status).toBe(201);
    const session = (await login.json()) as { data: { csrfToken: string } };
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const headers = {
      Cookie: cookie,
      Origin: origin,
      "X-CSRF-Token": session.data.csrfToken,
    };
    const creation = await fetch(
      `${apiBase}/api/v1/courses/${courseId}/posts`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": uuidv7(),
        },
        body: JSON.stringify({
          type: "question",
          title: "Image and document smoke",
          bodyMarkdown: "A **saved** question",
          tags: [],
        }),
      },
    );
    expect(creation.status).toBe(201);
    const post = (await creation.json()) as { data: { id: string } };
    const uploaded: { id: string; downloadUrl: string }[] = [];
    for (const file of files) {
      const key = uuidv7();
      const upload = () => {
        const form = new FormData();
        form.set(
          "file",
          new Blob([Uint8Array.from(file.bytes)], { type: file.type }),
          file.name,
        );
        return fetch(`${apiBase}/api/v1/posts/${post.data.id}/attachments`, {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": key },
          body: form,
        });
      };
      const created = await upload();
      expect(created.status).toBe(201);
      const value = (await created.json()) as {
        data: { id: string; downloadUrl: string };
      };
      uploaded.push(value.data);
      const replay = await upload();
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(value);
      const bytes = await fetch(`${apiBase}${value.data.downloadUrl}`, {
        headers: { Cookie: cookie },
      });
      expect(bytes.status).toBe(200);
      expect(Buffer.from(await bytes.arrayBuffer())).toEqual(file.bytes);
      expect(bytes.headers.get("cache-control")).toBe("private, no-store");
      expect((await fetch(`${apiBase}${value.data.downloadUrl}`)).status).toBe(
        401,
      );
    }
    const bad = new FormData();
    bad.set(
      "file",
      new Blob(["<script>malicious()</script>"], { type: "image/png" }),
      "fake.png",
    );
    const rejected = await fetch(
      `${apiBase}/api/v1/posts/${post.data.id}/attachments`,
      {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": uuidv7() },
        body: bad,
      },
    );
    expect(rejected.status).toBe(415);
    const attachment = uploaded[0];
    const removed = await fetch(
      `${apiBase}/api/v1/attachments/${attachment.id}`,
      { method: "DELETE", headers },
    );
    expect(removed.status).toBe(204);
    expect(
      (
        await fetch(`${apiBase}${attachment.downloadUrl}`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(404);
    const key = `courses/${courseId}/attachments/${attachment.id}`;
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    ).resolves.toBeDefined();
    const worker = start("../jobs/main.ts");
    await waitFor(async () => {
      if (worker.exitCode !== null) throw new Error("Attachment worker exited");
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return false;
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        )
          return true;
        throw error;
      }
    });
    const detail = await fetch(`${apiBase}/api/v1/posts/${post.data.id}`, {
      headers: { Cookie: cookie },
    });
    expect(detail.status).toBe(200);
    expect(
      ((await detail.json()) as { data: { attachments: unknown[] } }).data
        .attachments,
    ).toHaveLength(2);
  }, 15000);
});
