import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { isValidPassword } from "../auth/crypto.js";

export const AMS161_DEMO = {
  organizationId: "01a0e5c5-1266-727a-8d9a-fbb5da4cd0d1",
  organizationDomain: "ams161.mock.chalktalk.invalid",
  courseId: "01a0e5a4-2985-7445-b435-1927a9a02715",
  joinCode: "AMS16101",
  instructorEmail: "maya.chen@ams161.mock.chalktalk.invalid",
} as const;

// Existing local volumes may already have this organization marker.
const LEGACY_AMS161_ORGANIZATION_ID = "a1610000-0000-7000-8000-000000000001";

const students = [
  ["Alex Rivera", "alex.rivera@ams161.mock.chalktalk.invalid"],
  ["Jordan Patel", "jordan.patel@ams161.mock.chalktalk.invalid"],
  ["Taylor Brooks", "taylor.brooks@ams161.mock.chalktalk.invalid"],
] as const;

const questions = [
  {
    title: "When should I use integration by parts?",
    body: "I can integrate x e^x, but how do I choose u and dv for products like x^2 ln(x)? Is there a useful rule for deciding?",
  },
  {
    title: "How do I set up a disk or washer volume?",
    body: "For the region between y = x^2 and y = 2x, rotated around the x-axis, why does the washer method use two radii?",
  },
  {
    title: "How do I find the radius for cylindrical shells?",
    body: "For the same region between y = x^2 and y = 2x rotated around the y-axis, what are the shell radius and height?",
  },
  {
    title: "Does the harmonic series converge?",
    body: "The terms 1/n approach zero, but the harmonic series still diverges. What does the divergence test actually establish?",
  },
  {
    title: "Which convergence test fits this series?",
    body: "For sum of n/(n^3 + 1), is a comparison with 1/n^2 enough, or should I use the integral test?",
  },
  {
    title: "How do I find the interval of convergence?",
    body: "I found radius 2 for a power series centered at 1. How do I test the endpoints x = -1 and x = 3 separately?",
  },
  {
    title: "Why does the alternating series test work here?",
    body: "For sum (-1)^n/n, the absolute series diverges. Which conditions make the alternating series converge?",
  },
  {
    title: "How accurate is a Taylor polynomial?",
    body: "For approximating sin(x) near zero with a cubic Taylor polynomial, how do I bound the remainder?",
  },
  {
    title: "How do I parametrize an arc length problem?",
    body: "For y = x^(3/2) from x = 0 to x = 4, where does the square root in the arc length formula come from?",
  },
] as const;

const similarQuestions = [
  {
    title: "Choosing u for integration by parts",
    body: "When integrating x squared times log x, should I pick logarithm as u or the polynomial?",
  },
  {
    title: "Volume by washers around the x axis",
    body: "I have y equals x squared and y equals 2x. Which curve gives the outside radius when revolving about the x-axis?",
  },
  {
    title: "Why is 1 over n divergent?",
    body: "If 1/n tends to zero, why does its infinite sum not converge?",
  },
] as const;

export async function seedAms161(
  pool: Pool,
  source: Partial<
    Record<"MOCK_DATA" | "AMS161_DEMO_INSTRUCTOR_PASSWORD", string>
  >,
): Promise<"disabled" | "created" | "already-seeded"> {
  if (source.MOCK_DATA === undefined || source.MOCK_DATA === "false")
    return "disabled";
  if (source.MOCK_DATA !== "true")
    throw new Error("MOCK_DATA must be true or false");
  const password = source.AMS161_DEMO_INSTRUCTOR_PASSWORD;
  if (!isValidPassword(password))
    throw new Error(
      "AMS161_DEMO_INSTRUCTOR_PASSWORD must be 12 to 128 characters when MOCK_DATA=true",
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      // Serialize startup attempts without creating a separate migration or marker table.
      await client.query("SELECT pg_advisory_xact_lock(161001, 161002)");
      const marker = await client.query<{ id: string; domain: string }>(
        "SELECT id, domain FROM organizations WHERE id=$1 OR id=$2 OR domain=$3",
        [
          AMS161_DEMO.organizationId,
          LEGACY_AMS161_ORGANIZATION_ID,
          AMS161_DEMO.organizationDomain,
        ],
      );
      if (marker.rows.length > 0) {
        if (
          marker.rows.length !== 1 ||
          ![AMS161_DEMO.organizationId, LEGACY_AMS161_ORGANIZATION_ID].includes(
            marker.rows[0]!.id,
          ) ||
          marker.rows[0]!.domain !== AMS161_DEMO.organizationDomain
        )
          throw new Error(
            "AMS161 mock-data organization marker collides with existing data",
          );
        await client.query("COMMIT");
        return "already-seeded";
      }
      const collision = await client.query(
        "SELECT id FROM courses WHERE id=$1 OR join_code=$2 LIMIT 1",
        [AMS161_DEMO.courseId, AMS161_DEMO.joinCode],
      );
      if (collision.rowCount)
        throw new Error(
          "AMS161 mock-data course ID or join code collides with existing data",
        );
      const emailCollision = await client.query(
        "SELECT email FROM users WHERE email = ANY($1::text[]) AND deleted_at IS NULL LIMIT 1",
        [
          [
            AMS161_DEMO.instructorEmail,
            ...students.map((student) => student[1]),
          ],
        ],
      );
      if (emailCollision.rowCount)
        throw new Error(
          "AMS161 mock-data email collides with an existing user",
        );

      await client.query(
        "INSERT INTO organizations (id,domain,name) VALUES ($1,$2,$3)",
        [
          AMS161_DEMO.organizationId,
          AMS161_DEMO.organizationDomain,
          "AMS161 Prototype",
        ],
      );
      const instructorId = uuidv7();
      const people = [
        {
          id: instructorId,
          name: "Maya Chen",
          email: AMS161_DEMO.instructorEmail,
          password,
        },
        ...students.map(([name, email]) => ({
          id: uuidv7(),
          name,
          email,
          password: randomBytes(32).toString("base64url"),
        })),
      ];
      for (const person of people) {
        await client.query(
          "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)",
          [
            person.id,
            AMS161_DEMO.organizationId,
            person.email,
            person.name,
            await argon2.hash(person.password, { type: argon2.argon2id }),
          ],
        );
      }
      await client.query(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'AMS161',$4)",
        [
          AMS161_DEMO.courseId,
          AMS161_DEMO.organizationId,
          instructorId,
          AMS161_DEMO.joinCode,
        ],
      );
      for (const [index, person] of people.entries()) {
        await client.query(
          "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,$3)",
          [
            AMS161_DEMO.courseId,
            person.id,
            index === 0 ? "instructor" : "student",
          ],
        );
      }
      for (const [index, question] of questions.entries()) {
        await client.query(
          "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question',$4,$5)",
          [
            uuidv7(),
            AMS161_DEMO.courseId,
            people[1 + (index % 3)]!.id,
            question.title,
            question.body,
          ],
        );
      }
      for (const [index, question] of similarQuestions.entries()) {
        await client.query(
          "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question',$4,$5)",
          [
            uuidv7(),
            AMS161_DEMO.courseId,
            people[1 + (index % 3)]!.id,
            question.title,
            question.body,
          ],
        );
      }
      await client.query("COMMIT");
      return "created";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  if (
    process.env.MOCK_DATA !== undefined &&
    process.env.MOCK_DATA !== "false" &&
    process.env.MOCK_DATA !== "true"
  )
    throw new Error("MOCK_DATA must be true or false");
  if (
    process.env.MOCK_DATA !== "true" &&
    (process.env.MOCK_DATA === undefined || process.env.MOCK_DATA === "false")
  ) {
    process.stdout.write("AMS161 mock data disabled.\n");
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error("DATABASE_URL is required when MOCK_DATA=true");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await seedAms161(pool, process.env);
    process.stdout.write(`AMS161 mock data ${result}.\n`);
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
)
  await main();
