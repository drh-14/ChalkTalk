// Shared setup for live-stack browser tests. Each seed creates accounts and,
// unless opted out, a course. See documentation/testing.md for isolation setup.
import { randomUUID } from "node:crypto";
import process from "node:process";
import argon2 from "argon2";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { expect } from "@playwright/test";

export const BASE = process.env.E2E_BASE_URL ?? "https://localhost:5173";
export const databaseUrl = process.env.E2E_DATABASE_URL;
const PASSWORD = "live session e2e password";

export async function assertIsolatedDatabase(
  database,
  { databaseUrl, expectedToken, expectedSystemIdentifier },
) {
  if (!databaseUrl)
    throw new Error("An explicit E2E_DATABASE_URL is required before seeding");
  if (!/^[0-9a-f]{48}$/.test(expectedToken ?? ""))
    throw new Error(
      "A fresh 48-character E2E database guard token is required before seeding",
    );
  if (!expectedSystemIdentifier)
    throw new Error(
      "A Compose PostgreSQL instance identifier is required before seeding",
    );
  let instanceRows;
  try {
    ({ rows: instanceRows } = await database.query(
      "SELECT system_identifier::text FROM pg_control_system()",
    ));
  } catch {
    throw new Error("The target database instance could not be verified");
  }
  if (
    instanceRows.length !== 1 ||
    instanceRows[0].system_identifier !== expectedSystemIdentifier
  )
    throw new Error("The target database instance does not match Compose");
  let rows;
  try {
    ({ rows } = await database.query("SELECT token FROM chalktalk_e2e_guard"));
  } catch {
    throw new Error("The target database has no isolated E2E database guard");
  }
  if (rows.length !== 1 || rows[0].token !== expectedToken)
    throw new Error("The isolated E2E database guard does not match this run");
}

export async function seed({ withCourse = true, withInstructor = false } = {}) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const suffix = randomUUID().slice(0, 8);
  const domain = `e2e-${suffix}.example.edu`;
  const organizationId = uuidv7();
  const courseId = uuidv7();
  const postId = uuidv7();
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const people = {
    student: { id: uuidv7(), name: `Sam Student ${suffix}`, role: "student" },
    ta: {
      id: uuidv7(),
      name: `Tara TA ${suffix}`,
      role: withInstructor ? "instructor" : "ta",
    },
    classmate: {
      id: uuidv7(),
      name: `Cam Classmate ${suffix}`,
      role: "student",
    },
  };
  let client;
  try {
    if (!databaseUrl)
      throw new Error(
        "An explicit E2E_DATABASE_URL is required before seeding",
      );
    client = await pool.connect();
    await assertIsolatedDatabase(client, {
      databaseUrl,
      expectedToken: process.env.E2E_DB_GUARD_TOKEN,
      expectedSystemIdentifier: process.env.E2E_DB_SYSTEM_IDENTIFIER,
    });
    await client.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,$2,'E2E University')",
      [organizationId, domain],
    );
    for (const [key, person] of Object.entries(people)) {
      person.email = `${key}@${domain}`;
      await client.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)",
        [person.id, organizationId, person.email, person.name, passwordHash],
      );
    }
    if (withCourse) {
      await client.query(
        "INSERT INTO courses (id,organization_id,name,created_by_user_id,join_code) VALUES ($1,$2,$3,$4,$5)",
        [
          courseId,
          organizationId,
          `E2E ${suffix}`,
          people.ta.id,
          suffix.toUpperCase(),
        ],
      );
      for (const person of Object.values(people))
        await client.query(
          "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,$3)",
          [courseId, person.id, person.role],
        );
      await client.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','My loop never stops','Help with my while loop.')",
        [postId, courseId, people.student.id],
      );
    }
  } finally {
    client?.release();
    await pool.end();
  }
  return {
    courseId: withCourse ? courseId : undefined,
    postId: withCourse ? postId : undefined,
    people,
    organizationId,
  };
}

export async function signIn(browser, person) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(BASE);
  const response = await page.request.post(`${BASE}/api/v1/sessions`, {
    headers: { Origin: BASE, "Content-Type": "application/json" },
    data: { email: person.email, password: PASSWORD },
  });
  expect(response.status()).toBe(201);
  return { context, page };
}
