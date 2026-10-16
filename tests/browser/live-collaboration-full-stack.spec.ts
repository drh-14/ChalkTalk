import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import argon2 from "argon2";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { createServer as createViteServer } from "vite";
import { expect, test } from "@playwright/test";
import { AnswerService } from "../../apps/api/src/answers/service.js";
import { AuthService } from "../../apps/api/src/auth/service.js";
import { CollaborationStore } from "../../apps/api/src/collaboration/store.js";
import { createCollaborationServer } from "../../apps/api/src/collaboration/server.js";
import { loadEnvironment } from "../../apps/api/src/config/environment.js";
import { CourseService } from "../../apps/api/src/courses/service.js";
import {
  getMigrationDirectory,
  runMigrations,
} from "../../apps/api/src/database/migrate.js";
import { FollowupService } from "../../apps/api/src/followups/service.js";
import { createApp } from "../../apps/api/src/http/app.js";
import { PostService } from "../../apps/api/src/posts/service.js";
import { StatisticsService } from "../../apps/api/src/statistics/service.js";
import { createViteConfig } from "../../apps/web/vite.config.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const fullStack = databaseUrl && redisUrl ? test.describe : test.describe.skip;
test.use({
  launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
    : {},
});
const schema = `live_browser_${process.pid}_${Date.now()}`;
const password = "Browser-test-password-123";
const studentEmail = `student-${schema}@example.edu`;
const instructorEmail = `instructor-${schema}@example.edu`;
const ids = {
  organization: uuidv7(),
  course: uuidv7(),
  post: uuidv7(),
  student: uuidv7(),
  instructor: uuidv7(),
};

async function unusedPort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve, reject) =>
    server.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(),
    ),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await promisify(server.close.bind(server))();
  return address.port;
}

fullStack("real browser → API → PostgreSQL/Redis collaboration", () => {
  let admin: Pool;
  let pool: Pool;
  let api: ReturnType<ReturnType<typeof createApp>["listen"]>;
  let collaboration: ReturnType<typeof createCollaborationServer>;
  let vite: Awaited<ReturnType<typeof createViteServer>>;
  let certificateDirectory: string;
  let origin: string;
  let answerId: string;
  let followupId: string;

  test.beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    const passwordHash = await argon2.hash(password);
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Browser test')",
      [ids.organization],
    );
    for (const [id, email, displayName] of [
      [ids.student, studentEmail, "Browser student"],
      [ids.instructor, instructorEmail, "Browser instructor"],
    ]) {
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)",
        [id, ids.organization, email, displayName, passwordHash],
      );
    }
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Browser course','BROWSER1')",
      [ids.course, ids.organization, ids.instructor],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'instructor')",
      [ids.course, ids.student, ids.instructor],
    );
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Live browser question','Body')",
      [ids.post, ids.course, ids.student],
    );
    answerId = (
      await new AnswerService(pool).create(ids.post, ids.student, {
        bodyMarkdown: "Initial **answer** and $x^2$",
        anonymous: false,
      })
    ).value.id;
    followupId = (
      await new FollowupService(pool).create(ids.post, ids.student, {
        bodyMarkdown: "Initial **followup** and $y^2$",
        anonymous: false,
      })
    ).id;

    const webPort = await unusedPort();
    origin = `https://localhost:${webPort}`;
    const environment = loadEnvironment({
      AUTH_TOKEN_SECRET:
        "browser-test-secret-longer-than-thirty-two-characters",
      ALLOWED_SCHOOL_DOMAINS: "example.edu",
      FRONTEND_ORIGINS: origin,
      FRONTEND_BASE_URL: origin,
    });
    const app = createApp({
      environment,
      authService: new AuthService(pool, environment, { send: async () => {} }),
      courseService: new CourseService(pool),
      postService: new PostService(pool),
      answerService: new AnswerService(pool),
      followupService: new FollowupService(pool),
      collaborationStore: new CollaborationStore(pool),
      statisticsService: new StatisticsService(pool),
    });
    api = await new Promise((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => resolve(server));
    });
    const apiAddress = api.address();
    if (!apiAddress || typeof apiAddress === "string")
      throw new Error("API did not bind");

    collaboration = createCollaborationServer({
      store: new CollaborationStore(pool),
      redisUrl: redisUrl!,
      redisPrefix: `chalktalk-browser-${schema}`,
      allowedOrigins: new Set([origin]),
      port: 0,
      address: "127.0.0.1",
    });
    await collaboration.listen();

    certificateDirectory = mkdtempSync(join(tmpdir(), "chalktalk-browser-"));
    const key = join(certificateDirectory, "key.pem");
    const cert = join(certificateDirectory, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-keyout",
        key,
        "-out",
        cert,
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost",
      ],
      { stdio: "ignore" },
    );
    const config = createViteConfig({
      VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiAddress.port}`,
      VITE_COLLABORATION_PROXY_TARGET: new URL(
        collaboration.webSocketURL,
      ).origin.replace(/^ws:/, "http:"),
    });
    vite = await createViteServer({
      ...config,
      configFile: false,
      root: join(root, "apps/web"),
      server: {
        ...config.server,
        host: "localhost",
        port: webPort,
        strictPort: true,
        https: { key: readFileSync(key), cert: readFileSync(cert) },
      },
    });
    await vite.listen();
  }, 60_000);

  test.afterAll(async () => {
    await vite?.close();
    await collaboration?.destroy();
    if (api) await promisify(api.close.bind(api))();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (certificateDirectory)
      rmSync(certificateDirectory, { recursive: true, force: true });
  }, 30_000);

  async function signedInPage(
    browser: Parameters<Parameters<typeof test>[1]>[0]["browser"],
    email: string,
  ) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${origin}/home`);
    await page.goto(`${origin}/courses/${ids.course}/posts/${ids.post}`);
    await expect(
      page.getByRole("heading", { name: "Live browser question" }),
    ).toBeVisible();
    return { context, page };
  }

  for (const kind of ["answer", "followup"] as const) {
    test(`${kind} edits synchronize between two real signed-in browsers and survive reload`, async ({
      browser,
    }) => {
      const student = await signedInPage(browser, studentEmail);
      const instructor = await signedInPage(browser, instructorEmail);
      try {
        const region =
          kind === "answer"
            ? (page: typeof student.page) =>
                page.getByRole("region", { name: "Answer by Browser student" })
            : (page: typeof student.page) =>
                page.getByRole("article", {
                  name: "Followup by Browser student",
                });
        await region(student.page)
          .getByRole("button", { name: `Edit ${kind}` })
          .click();
        await region(instructor.page)
          .getByRole("button", { name: `Edit ${kind}` })
          .click();
        await expect(region(student.page).getByRole("status")).toContainText(
          "Connected",
        );
        await expect(region(instructor.page).getByRole("status")).toContainText(
          "Connected",
        );
        const editor = region(student.page).getByRole("textbox", {
          name: kind === "answer" ? "Answer" : "Followup",
        });
        const peer = region(instructor.page).getByRole("textbox", {
          name: kind === "answer" ? "Answer" : "Followup",
        });
        const addition = ` Browser ${kind} **edit** with $\\alpha$`;
        await editor.click();
        await student.page.keyboard.press("End");
        await student.page.keyboard.type(addition);
        await expect(peer).toContainText(`Browser ${kind} **edit** with`);
        const id = kind === "answer" ? answerId : followupId;
        const table = kind === "answer" ? "answers" : "followups";
        await expect
          .poll(async () => {
            const saved = await pool.query<{ body_markdown: string }>(
              `SELECT body_markdown FROM ${table} WHERE id=$1`,
              [id],
            );
            return saved.rows[0]?.body_markdown;
          })
          .toContain(`Browser ${kind} **edit** with`);
        await region(instructor.page).screenshot({
          path: join(
            root,
            "docs/pr-screenshots/live-collaboration",
            `full-stack-${kind}.png`,
          ),
        });
        await instructor.page.reload();
        await region(instructor.page)
          .getByRole("button", { name: `Edit ${kind}` })
          .click();
        await expect(
          region(instructor.page).getByRole("textbox", {
            name: kind === "answer" ? "Answer" : "Followup",
          }),
        ).toContainText(`Browser ${kind} **edit** with`);
      } finally {
        await student.context.close();
        await instructor.context.close();
      }
    });
  }
});
