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

type Person = "maya" | "sam" | "alex" | "jordan" | "taylor" | "casey";

const members: {
  key: Person;
  name: string;
  email: string;
  role: "instructor" | "ta" | "student";
}[] = [
  {
    key: "maya",
    name: "Maya Chen",
    email: AMS161_DEMO.instructorEmail,
    role: "instructor",
  },
  {
    key: "sam",
    name: "Sam Okafor",
    email: "sam.okafor@ams161.mock.chalktalk.invalid",
    role: "ta",
  },
  {
    key: "alex",
    name: "Alex Rivera",
    email: "alex.rivera@ams161.mock.chalktalk.invalid",
    role: "student",
  },
  {
    key: "jordan",
    name: "Jordan Patel",
    email: "jordan.patel@ams161.mock.chalktalk.invalid",
    role: "student",
  },
  {
    key: "taylor",
    name: "Taylor Brooks",
    email: "taylor.brooks@ams161.mock.chalktalk.invalid",
    role: "student",
  },
  {
    key: "casey",
    name: "Casey Morgan",
    email: "casey.morgan@ams161.mock.chalktalk.invalid",
    role: "student",
  },
];

const HOUR = 60;
const DAY = 24 * HOUR;

type SeedAnswer = {
  author: Person;
  body: string;
  /** Minutes before the seed ran. */
  age: number;
  endorsedBy?: Person;
};

type SeedPost = {
  type: "question" | "note";
  author: Person;
  title: string;
  body: string;
  /** Minutes before the seed ran; spread so feeds show relative and full dates. */
  age: number;
  tags: string[];
  pinned?: boolean;
  anonymous?: boolean;
  studentAnswer?: SeedAnswer;
  staffAnswer?: SeedAnswer;
};

const posts: SeedPost[] = [
  {
    type: "note",
    author: "maya",
    title: "Welcome to AMS161: how to use this forum",
    body: "Welcome to Calculus II! A few ground rules:\n\n- **Search first.** Someone may already have asked your question.\n- Post **questions** when you are stuck and **notes** for resources you want to share.\n- You may post anonymously to classmates; staff can still see who you are.\n- Please don't post full homework solutions before the due date.",
    age: 120 * DAY,
    tags: ["logistics"],
    pinned: true,
  },
  {
    type: "question",
    author: "jordan",
    title: "Does the integral of 1/x^p from 1 to infinity converge when p = 1?",
    body: "I know it converges for p > 2, but what happens exactly at p = 1? My antiderivative turns into ln(x) and I'm not sure how to take the limit.",
    age: 110 * DAY,
    tags: ["improper-integrals"],
    staffAnswer: {
      author: "maya",
      body: "At p = 1 the antiderivative is ln(x), and ln(b) grows without bound as b goes to infinity, so the integral **diverges**. The p-test says the integral converges exactly when **p > 1**, not p > 2.",
      age: 109 * DAY,
    },
  },
  {
    type: "question",
    author: "taylor",
    title: "How do I parametrize an arc length problem?",
    body: "For y = x^(3/2) from x = 0 to x = 4, where does the square root in the arc length formula come from?",
    age: 60 * DAY,
    tags: ["arc-length"],
    studentAnswer: {
      author: "alex",
      body: "Think of a tiny piece of the curve as the hypotenuse of a right triangle with legs dx and dy. Its length is sqrt(dx^2 + dy^2) = sqrt(1 + (dy/dx)^2) dx.",
      age: 59 * DAY,
    },
    staffAnswer: {
      author: "sam",
      body: "Alex's picture is exactly right. Here dy/dx = (3/2) x^(1/2), so the integrand becomes sqrt(1 + 9x/4). A u-substitution with u = 1 + 9x/4 finishes it.",
      age: 58 * DAY,
    },
  },
  {
    type: "question",
    author: "alex",
    title: "When should I use integration by parts?",
    body: "I can integrate x e^x, but how do I choose u and dv for products like x^2 ln(x)? Is there a useful rule for deciding?",
    age: 45 * DAY,
    tags: ["integration"],
    studentAnswer: {
      author: "jordan",
      body: "Pick u = ln(x) because its derivative 1/x is simpler, and dv = x^2 dx because it is easy to integrate.",
      age: 44 * DAY,
      endorsedBy: "maya",
    },
    staffAnswer: {
      author: "maya",
      body: "A handy rule of thumb is **LIATE**: choose u from the first type that appears in the list\n\n1. Logarithmic\n2. Inverse trig\n3. Algebraic\n4. Trigonometric\n5. Exponential\n\nFor x^2 ln(x), that makes u = ln(x).",
      age: 44 * DAY - 3 * HOUR,
    },
  },
  {
    type: "question",
    author: "jordan",
    title: "How do I set up a disk or washer volume?",
    body: "For the region between y = x^2 and y = 2x, rotated around the x-axis, why does the washer method use two radii?",
    age: 30 * DAY,
    tags: ["volumes"],
    studentAnswer: {
      author: "taylor",
      body: "The region has a hole in it once you rotate it. The outer radius is the top curve (2x) and the inner radius is the bottom curve (x^2), so each slice is pi(R^2 - r^2) dx.",
      age: 29 * DAY,
    },
  },
  {
    type: "question",
    author: "taylor",
    title: "How do I find the radius for cylindrical shells?",
    body: "For the same region between y = x^2 and y = 2x rotated around the y-axis, what are the shell radius and height?",
    age: 29 * DAY,
    tags: ["volumes"],
  },
  {
    type: "question",
    author: "taylor",
    title: "Partial fractions with a repeated linear factor",
    body: "For (3x + 5)/(x - 1)^2, do I need both A/(x - 1) and B/(x - 1)^2, or is one term enough?",
    age: 20 * DAY,
    tags: ["integration"],
    anonymous: true,
    studentAnswer: {
      author: "jordan",
      body: "You need both. A repeated factor (x - 1)^2 contributes one term for each power: A/(x - 1) + B/(x - 1)^2.",
      age: 19 * DAY,
    },
  },
  {
    type: "question",
    author: "alex",
    title: "Does the harmonic series converge?",
    body: "The terms 1/n approach zero, but the harmonic series still diverges. What does the divergence test actually establish?",
    age: 14 * DAY,
    tags: ["series"],
    staffAnswer: {
      author: "sam",
      body: "The divergence test only works in one direction: if the terms **don't** go to zero, the series diverges. Terms going to zero tells you nothing. For 1/n, compare with the integral of 1/x, which diverges.",
      age: 13 * DAY,
    },
  },
  {
    type: "question",
    author: "alex",
    title: "Why does the alternating series test work here?",
    body: "For sum (-1)^n/n, the absolute series diverges. Which conditions make the alternating series converge?",
    age: 12 * DAY,
    tags: ["series"],
    studentAnswer: {
      author: "casey",
      body: "Two conditions: the terms 1/n decrease, and they go to zero. The partial sums then bounce back and forth in smaller and smaller steps, so they settle down. It converges conditionally, not absolutely.",
      age: 11 * DAY,
    },
  },
  {
    type: "note",
    author: "maya",
    title: "Midterm 1: what to expect",
    body: "Midterm 1 is in class next **Thursday**.\n\n- Covers sections 7.1 through 7.8 (integration techniques and improper integrals)\n- One page of handwritten notes allowed, both sides\n- No calculators\n\nPractice problems are posted under Course resources.",
    age: 9 * DAY,
    tags: ["midterm", "logistics"],
    pinned: true,
  },
  {
    type: "question",
    author: "casey",
    title: "Is the final exam cumulative?",
    body: "Will the final cover integration techniques again, or only series and parametric curves?",
    age: 8 * DAY,
    tags: ["logistics"],
    pinned: true,
    staffAnswer: {
      author: "maya",
      body: "Yes, the final is cumulative. Expect roughly a third on integration techniques and applications and two thirds on sequences, series, and parametric curves.",
      age: 8 * DAY - 2 * HOUR,
    },
  },
  {
    type: "question",
    author: "jordan",
    title: "How accurate is a Taylor polynomial?",
    body: "For approximating sin(x) near zero with a cubic Taylor polynomial, how do I bound the remainder?",
    age: 5 * DAY,
    tags: ["taylor-series"],
    staffAnswer: {
      author: "maya",
      body: "Use the Lagrange remainder: |R_3(x)| <= M |x|^4 / 4!, where M bounds the fourth derivative. Every derivative of sin is at most 1, so M = 1.",
      age: 4 * DAY,
    },
  },
  {
    type: "note",
    author: "taylor",
    title: "Series tests cheat sheet",
    body: "My one-page summary for the midterm:\n\n- **Divergence test:** terms don't go to 0, so it diverges\n- **Comparison / limit comparison:** match against p-series or geometric series\n- **Ratio test:** good for factorials and exponentials\n- **Root test:** good for nth powers\n- **Integral test:** positive, decreasing, continuous terms",
    age: 3 * DAY,
    tags: ["series", "midterm"],
  },
  {
    type: "question",
    author: "casey",
    title: "Choosing u for integration by parts",
    body: "When integrating x squared times log x, should I pick logarithm as u or the polynomial?",
    age: 2 * DAY,
    tags: ["integration"],
  },
  {
    type: "note",
    author: "casey",
    title: "Study group Sunday at the library",
    body: "A few of us are meeting Sunday at 2pm on the second floor of the library to work through the series practice problems. Everyone is welcome!",
    age: DAY + 2 * HOUR,
    tags: ["study-group"],
  },
  {
    type: "note",
    author: "sam",
    title: "Office hours moved to Thursday this week",
    body: "My Wednesday office hours are moving to **Thursday 3 to 5pm** this week only, same room.",
    age: 20 * HOUR,
    tags: ["office-hours"],
  },
  {
    type: "question",
    author: "jordan",
    title: "Which convergence test fits this series?",
    body: "For sum of n/(n^3 + 1), is a comparison with 1/n^2 enough, or should I use the integral test?",
    age: 6 * HOUR,
    tags: ["series"],
  },
  {
    type: "question",
    author: "taylor",
    title: "How do I find the interval of convergence?",
    body: "I found radius 2 for a power series centered at 1. How do I test the endpoints x = -1 and x = 3 separately?",
    age: 6 * HOUR - 20,
    tags: ["series", "power-series"],
  },
  {
    type: "question",
    author: "alex",
    title: "Is the ratio test inconclusive when the limit is exactly 1?",
    body: "I got a limit of 1 on problem 4. Does that mean I have to try a different test?",
    age: 4 * HOUR,
    tags: ["series"],
    staffAnswer: {
      author: "sam",
      body: "Yes. A limit of exactly 1 tells you nothing, since both 1/n and 1/n^2 give 1. Try a comparison test instead.",
      age: 2 * HOUR,
    },
  },
  {
    type: "question",
    author: "alex",
    title: "Volume by washers around the x axis",
    body: "I have y equals x squared and y equals 2x. Which curve gives the outside radius when revolving about the x-axis?",
    age: 3 * HOUR,
    tags: ["volumes"],
  },
  {
    type: "question",
    author: "alex",
    title: "Sign error in trig substitution with secant",
    body: "When I substitute x = 3 sec(t) into sqrt(x^2 - 9), should I get 3 tan(t) or |3 tan(t)|?",
    age: 50,
    tags: ["integration"],
  },
  {
    type: "question",
    author: "jordan",
    title: "Why is 1 over n divergent?",
    body: "If 1/n tends to zero, why does its infinite sum not converge?",
    age: 25,
    tags: ["series"],
    anonymous: true,
  },
];

/** Fixture size, for tests and documentation. */
export const AMS161_FIXTURE = {
  posts: posts.length,
  questions: posts.filter((post) => post.type === "question").length,
  notes: posts.filter((post) => post.type === "note").length,
} as const;

// Answer collaboration documents start from an empty Yjs update, as in the answers service.
const EMPTY_YJS_UPDATE = Buffer.from([0, 0]);

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
        [members.map((member) => member.email)],
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
      // Only the instructor can sign in; everyone else gets a discarded random password.
      const ids = {} as Record<Person, string>;
      for (const member of members) {
        ids[member.key] = uuidv7();
        await client.query(
          "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)",
          [
            ids[member.key],
            AMS161_DEMO.organizationId,
            member.email,
            member.name,
            await argon2.hash(
              member.key === "maya"
                ? password
                : randomBytes(32).toString("base64url"),
              { type: argon2.argon2id },
            ),
          ],
        );
      }
      await client.query(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'AMS161',$4)",
        [
          AMS161_DEMO.courseId,
          AMS161_DEMO.organizationId,
          ids.maya,
          AMS161_DEMO.joinCode,
        ],
      );
      for (const member of members) {
        await client.query(
          "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,$3)",
          [AMS161_DEMO.courseId, ids[member.key], member.role],
        );
      }
      const tagIds = new Map<string, string>();
      for (const post of posts) {
        const postId = uuidv7();
        const answers = [
          ["student", post.studentAnswer],
          ["staff", post.staffAnswer],
        ] as const;
        // A post was last active when it was created or last answered.
        const activityAge = Math.min(
          post.age,
          ...answers.flatMap(([, answer]) => (answer ? [answer.age] : [])),
        );
        await client.query(
          "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,anonymous,pinned,created_at,updated_at,last_activity_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()-make_interval(mins=>$9),now()-make_interval(mins=>$9),now()-make_interval(mins=>$10))",
          [
            postId,
            AMS161_DEMO.courseId,
            ids[post.author],
            post.type,
            post.title,
            post.body,
            post.anonymous ?? false,
            post.pinned ?? false,
            post.age,
            activityAge,
          ],
        );
        for (const tag of post.tags) {
          if (!tagIds.has(tag)) {
            tagIds.set(tag, uuidv7());
            await client.query(
              "INSERT INTO tags (id,course_id,name) VALUES ($1,$2,$3)",
              [tagIds.get(tag), AMS161_DEMO.courseId, tag],
            );
          }
          await client.query(
            "INSERT INTO post_tags (post_id,tag_id) VALUES ($1,$2)",
            [postId, tagIds.get(tag)],
          );
        }
        for (const [kind, answer] of answers) {
          if (!answer) continue;
          const answerId = uuidv7();
          await client.query(
            "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,endorsed_at,endorsed_by_user_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,CASE WHEN $6::uuid IS NULL THEN NULL ELSE now()-make_interval(mins=>$7) END,$6,now()-make_interval(mins=>$7),now()-make_interval(mins=>$7))",
            [
              answerId,
              AMS161_DEMO.courseId,
              postId,
              kind,
              answer.body,
              answer.endorsedBy ? ids[answer.endorsedBy] : null,
              answer.age,
            ],
          );
          await client.query(
            "INSERT INTO answer_collaboration_documents (answer_id,yjs_state) VALUES ($1,$2)",
            [answerId, EMPTY_YJS_UPDATE],
          );
          await client.query(
            "INSERT INTO answer_contributors (answer_id,user_id) VALUES ($1,$2)",
            [answerId, ids[answer.author]],
          );
        }
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
