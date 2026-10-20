// Shared setup for browser tests against the running development stack
// (`npm run dev`). Each run seeds its own course and accounts directly in the
// database named by E2E_DATABASE_URL (or DATABASE_URL).
import { randomUUID } from "node:crypto";
import process from "node:process";
import argon2 from "argon2";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { expect } from "@playwright/test";

export const BASE = process.env.E2E_BASE_URL ?? "https://localhost:5173";
export const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
const PASSWORD = "live session e2e password";

export async function seed() {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const suffix = randomUUID().slice(0, 8);
  const domain = `e2e-${suffix}.example.edu`;
  const organizationId = uuidv7();
  const courseId = uuidv7();
  const postId = uuidv7();
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const people = {
    student: { id: uuidv7(), name: `Sam Student ${suffix}`, role: "student" },
    ta: { id: uuidv7(), name: `Tara TA ${suffix}`, role: "ta" },
    classmate: { id: uuidv7(), name: `Cam Classmate ${suffix}`, role: "student" },
  };
  try {
    await pool.query("INSERT INTO organizations (id,domain,name) VALUES ($1,$2,'E2E University')", [
      organizationId,
      domain,
    ]);
    for (const [key, person] of Object.entries(people)) {
      person.email = `${key}@${domain}`;
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)",
        [person.id, organizationId, person.email, person.name, passwordHash],
      );
    }
    await pool.query(
      "INSERT INTO courses (id,organization_id,name,created_by_user_id,join_code) VALUES ($1,$2,$3,$4,$5)",
      [courseId, organizationId, `E2E ${suffix}`, people.ta.id, suffix.toUpperCase()],
    );
    for (const person of Object.values(people))
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,$3)",
        [courseId, person.id, person.role],
      );
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','My loop never stops','Help with my while loop.')",
      [postId, courseId, people.student.id],
    );
  } finally {
    await pool.end();
  }
  return { courseId, postId, people };
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
