/* global process, fetch, FormData, AbortSignal, Buffer, URL, Blob, console */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import pg from "pg";

const api = "http://127.0.0.1:3300";
const origin = "https://localhost:5173";
const compose = ["compose", "-f", "deployment/production/compose.ci.yml"];
const required = [
  "SUPABASE_S3_KEY_ID",
  "SUPABASE_S3_SECRET",
  "SUPABASE_DB_URL",
];
for (const key of required) assert.ok(process.env[key], `${key} is required`);

function runCompose(...args) {
  execFileSync("docker", [...compose, ...args], {
    stdio: "inherit",
    env: process.env,
  });
}

async function request(
  path,
  { method = "GET", body, session, headers = {} } = {},
) {
  const response = await fetch(api + path, {
    method,
    headers: {
      Origin: origin,
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...headers,
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = response.headers.get("content-type")?.includes("json")
    ? await response.json()
    : await response.text();
  return { response, payload };
}

async function expectStatus(path, options, expected) {
  const result = await request(path, options);
  assert.equal(
    result.response.status,
    expected,
    `${path}: ${JSON.stringify(result.payload)}`,
  );
  return result;
}

async function main() {
  const emails = [];
  const mail = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/emails") {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    emails.push(JSON.parse(Buffer.concat(chunks).toString()));
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ id: randomUUID() }));
  });
  await new Promise((resolve) => mail.listen(3339, "0.0.0.0", resolve));
  let stackStarted = false;
  const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const s3 = new S3Client({
    endpoint: "http://127.0.0.1:54321/storage/v1/s3",
    region: "local",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.SUPABASE_S3_KEY_ID,
      secretAccessKey: process.env.SUPABASE_S3_SECRET,
    },
  });
  try {
    const bucket = await pool.query(
      "SELECT public FROM storage.buckets WHERE id = 'chalktalk-ci'",
    );
    assert.equal(
      bucket.rows[0]?.public,
      false,
      "Supabase CI bucket must be private",
    );
    stackStarted = true;
    runCompose("up", "--build", "--wait", "api");
    const migrations = await pool.query(
      "SELECT count(*)::integer AS count FROM schema_migrations",
    );
    assert.ok(
      migrations.rows[0].count >= 50,
      "migration ledger must be populated",
    );

    async function createUser(name) {
      const email = `${name}@example.edu`;
      await expectStatus(
        "/api/v1/account-verification-requests",
        {
          method: "POST",
          body: { email },
          headers: { "Idempotency-Key": randomUUID() },
        },
        202,
      );
      const message = emails.findLast((item) => item.to === email);
      assert.ok(message?.text, `verification email missing for ${email}`);
      const url = new URL(message.text.match(/https?:\/\/\S+/)?.[0]);
      const verificationToken = url.searchParams.get("token");
      assert.ok(verificationToken);
      await expectStatus(
        "/api/v1/users",
        {
          method: "POST",
          body: {
            verificationToken,
            password: "correct horse battery staple",
            displayName: name,
          },
        },
        201,
      );
      const login = await expectStatus(
        "/api/v1/sessions",
        {
          method: "POST",
          body: { email, password: "correct horse battery staple" },
        },
        201,
      );
      return {
        cookie: login.response.headers.get("set-cookie").split(";")[0],
        csrf: login.payload.data.csrfToken,
      };
    }

    const instructor = await createUser("ci-instructor");
    const outsider = await createUser("ci-outsider");
    const orgs = await expectStatus(
      "/api/v1/organizations",
      { session: instructor },
      200,
    );
    const orgId = orgs.payload.data[0].id;
    const created = await expectStatus(
      `/api/v1/organizations/${orgId}/courses`,
      {
        method: "POST",
        session: instructor,
        body: { name: "Supabase CI course" },
        headers: { "Idempotency-Key": randomUUID() },
      },
      201,
    );
    const courseId = created.payload.data.id;
    assert.equal(
      created.response.headers.get("location"),
      `/api/v1/courses/${courseId}`,
    );
    assert.ok(created.response.headers.get("etag"));

    const form = new FormData();
    form.set(
      "file",
      new Blob(["Supabase storage integration\n"], { type: "text/plain" }),
      "ci-notes.txt",
    );
    const upload = await expectStatus(
      `/api/v1/courses/${courseId}/resources/files`,
      {
        method: "POST",
        session: instructor,
        body: form,
        headers: { "Idempotency-Key": randomUUID() },
      },
      201,
    );
    const fileId = upload.payload.data.id;
    assert.equal(
      upload.response.headers.get("location"),
      `/api/v1/courses/${courseId}/resources/${fileId}`,
    );
    assert.ok(upload.response.headers.get("etag"));
    const catalog = await expectStatus(
      `/api/v1/courses/${courseId}/resources`,
      { session: instructor },
      200,
    );
    assert.equal(catalog.payload.data[0].id, fileId);
    const downloaded = await expectStatus(
      `/api/v1/courses/${courseId}/files/${fileId}/download`,
      { session: instructor },
      200,
    );
    assert.equal(downloaded.payload, "Supabase storage integration\n");
    const denied = await expectStatus(
      `/api/v1/courses/${courseId}/files/${fileId}/download`,
      { session: outsider },
      404,
    );
    assert.equal(denied.payload.error.code, "not_found");
    const csrfDenied = await expectStatus(
      `/api/v1/courses/${courseId}/resources/files`,
      { method: "POST", body: form, headers: { Cookie: instructor.cookie } },
      403,
    );
    assert.equal(csrfDenied.payload.error.code, "csrf_validation_failed");
    const invalidPdf = new FormData();
    invalidPdf.set(
      "file",
      new Blob(["not a PDF"], { type: "application/pdf" }),
      "bad.pdf",
    );
    await expectStatus(
      `/api/v1/courses/${courseId}/resources/files`,
      {
        method: "POST",
        session: instructor,
        body: invalidPdf,
        headers: { "Idempotency-Key": randomUUID() },
      },
      415,
    );
    const fileCount = await pool.query(
      "SELECT count(*)::integer AS count FROM course_files WHERE course_id = $1 AND deleted_at IS NULL",
      [courseId],
    );
    assert.equal(fileCount.rows[0].count, 1, "failed upload must not persist");

    const objectKey = `ci-roundtrip/${randomUUID()}`;
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: "chalktalk-ci",
          Key: objectKey,
          Body: "roundtrip",
        }),
      );
      const object = await s3.send(
        new GetObjectCommand({ Bucket: "chalktalk-ci", Key: objectKey }),
      );
      assert.equal(await object.Body.transformToString(), "roundtrip");
    } finally {
      await s3.send(
        new DeleteObjectCommand({ Bucket: "chalktalk-ci", Key: objectKey }),
      );
    }

    const storageContainer = execFileSync(
      "docker",
      [
        "ps",
        "--filter",
        "name=supabase_storage_chalktalk-supabase-ci",
        "--format",
        "{{.ID}}",
      ],
      { encoding: "utf8" },
    ).trim();
    assert.ok(
      storageContainer,
      "local Supabase Storage container was not found",
    );
    execFileSync("docker", ["stop", "-t", "1", storageContainer]);
    try {
      const outageUpload = new FormData();
      outageUpload.set(
        "file",
        new Blob(["Storage outage should roll back\n"], {
          type: "text/plain",
        }),
        "outage.txt",
      );
      await expectStatus(
        `/api/v1/courses/${courseId}/resources/files`,
        {
          method: "POST",
          session: instructor,
          body: outageUpload,
          headers: { "Idempotency-Key": randomUUID() },
        },
        503,
      );
      const afterOutage = await pool.query(
        "SELECT count(*)::integer AS count FROM course_resources WHERE course_id = $1",
        [courseId],
      );
      assert.equal(
        afterOutage.rows[0].count,
        1,
        "storage outage must not commit a resource",
      );
    } finally {
      execFileSync("docker", ["start", storageContainer]);
    }
    console.log(
      "Supabase CI: migrations, private S3, real HTTP auth/course/resource, denial and outage checks passed",
    );
  } catch (error) {
    if (stackStarted) {
      try {
        runCompose("logs", "--no-color");
      } catch {
        // Preserve the original integration failure.
      }
    }
    throw error;
  } finally {
    if (stackStarted) runCompose("down", "--volumes", "--remove-orphans");
    await pool.end();
    s3.destroy();
    await new Promise((resolve) => mail.close(resolve));
  }
}

await main();
