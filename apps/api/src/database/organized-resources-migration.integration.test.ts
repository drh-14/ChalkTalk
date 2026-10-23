import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { describe, it, expect } from "vitest";
import { runMigrations, getMigrationDirectory } from "./migrate.js";
import { CourseResourceService } from "../course-resources/service.js";
import { createApp } from "../http/app.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService } from "../auth/service.js";
const url = process.env.TEST_DATABASE_URL,
  suite = url ? describe : describe.skip;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
suite("organized resource migration", () => {
  for (const syllabusAssigned of [false, true])
    it(`preserves legacy ungrouped files/links without preset sections (syllabus assigned: ${syllabusAssigned})`, async () => {
      const admin = new Pool({ connectionString: url }),
        schema = `resource_backfill_${randomUUID().replaceAll("-", "")}`,
        directory = await mkdtemp(
          join(tmpdir(), "chalktalk-resource-migrations-"),
        );
      let pool: Pool | undefined;
      try {
        await admin.query(`CREATE SCHEMA "${schema}"`);
        pool = new Pool({
          connectionString: url,
          options: `--search_path="${schema}"`,
        });
        for (const name of await readdir(getMigrationDirectory()))
          if (name.endsWith(".sql") && !name.startsWith("029_"))
            await copyFile(
              join(getMigrationDirectory(), name),
              join(directory, name),
            );
        await runMigrations(pool, directory);
        const org = randomUUID(),
          course = randomUUID(),
          user = randomUUID(),
          file = randomUUID(),
          oldFile = randomUUID(),
          spacedFile = randomUUID(),
          longFile = randomUUID(),
          blankFile = randomUUID(),
          link = randomUUID(),
          syllabus = randomUUID();
        const awkwardNames = [
          [spacedFile, " ".repeat(200) + ".txt", "2017-01-01", ".txt"],
          [
            longFile,
            " ".repeat(30) + "A".repeat(205) + ".txt",
            "2016-01-01",
            "A".repeat(200),
          ],
          [blankFile, " ".repeat(20), "2015-01-01", "Untitled file"],
        ];
        const trimCodePoints = [
          0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
          0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
          0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
          0xfeff,
        ];
        for (const codePoint of trimCodePoints) {
          const space = String.fromCodePoint(codePoint);
          expect(space.trim()).toBe("");
          awkwardNames.push([
            randomUUID(),
            space.repeat(200) + ".txt",
            "2014-01-01",
            ".txt",
          ]);
          awkwardNames.push([
            randomUUID(),
            space.repeat(20),
            "2014-01-01",
            "Untitled file",
          ]);
        }
        awkwardNames.push([
          randomUUID(),
          "\u00a0\u2003" + "Q".repeat(205) + "\u202f\ufeff",
          "2014-01-01",
          "Q".repeat(200),
        ]);
        await pool.query(
          "INSERT INTO organizations(id,domain,name) VALUES($1,'migration.example.edu','Example')",
          [org],
        );
        await pool.query(
          "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'ada@example.edu','Ada','x')",
          [user, org],
        );
        await pool.query(
          "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Course','ABCDEFGH')",
          [course, org, user],
        );
        await pool.query(
          "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'instructor')",
          [course, user],
        );
        for (const [id, name, date] of [
          [file, "Newest.txt", "2022-01-01"],
          [oldFile, "Older.txt", "2020-01-01"],
          ...awkwardNames.map(([id, name, date]) => [id, name, date]),
          ...(syllabusAssigned
            ? [[syllabus, "Syllabus.txt", "2018-01-01"]]
            : []),
        ])
          await pool.query(
            "INSERT INTO course_files(id,course_id,uploaded_by_user_id,object_key,file_name,media_type,size_bytes,checksum_sha256,created_at) VALUES($1,$2,$3,$4,$5,'text/plain',1,$6,$7)",
            [id, course, user, `legacy/${id}`, name, Buffer.alloc(32), date],
          );
        for (const [id, title, date] of [
          [file, "Legacy link", "2021-01-01"],
          [link, "Old link", "2019-01-01"],
        ])
          await pool.query(
            "INSERT INTO course_resource_links(id,course_id,title,url,created_at) VALUES($1,$2,$3,$4,$5)",
            [id, course, title, "https://example.edu/legacy", date],
          );
        const scope = `course-resource-link-create:${user}:${course}`;
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              title: "Legacy link",
              url: "https://example.edu/legacy",
            }),
          )
          .digest();
        const expiry = "2099-01-01T00:00:00Z";
        await pool.query(
          "INSERT INTO idempotency_records(scope,key,request_hash,response_status,response_body,expires_at) VALUES($1,'collision-replay',$2,201,$3,$4)",
          [
            scope,
            hash,
            {
              kind: "link",
              id: file,
              courseId: course,
              title: "Legacy link",
              url: "https://example.edu/legacy",
              createdAt: "2021-01-01T00:00:00.000Z",
            },
            expiry,
          ],
        );
        const oldHash = createHash("sha256")
          .update(
            JSON.stringify({
              title: "Old link",
              url: "https://example.edu/legacy",
            }),
          )
          .digest();
        await pool.query(
          "INSERT INTO idempotency_records(scope,key,request_hash,response_status,response_body,expires_at) VALUES($1,'noncollision-replay',$2,201,$3,$4)",
          [
            scope,
            oldHash,
            {
              kind: "link",
              id: link,
              courseId: course,
              title: "Old link",
              url: "https://example.edu/legacy",
              createdAt: "2019-01-01T00:00:00.000Z",
            },
            expiry,
          ],
        );
        await pool.query(
          "INSERT INTO idempotency_records(scope,key,request_hash,response_status,response_body,expires_at) VALUES($1,'file-replay',$2,201,$3,$4)",
          [
            `course-file-create:${user}:${course}`,
            Buffer.alloc(32),
            { id: file, courseId: course, fileName: "Newest.txt" },
            expiry,
          ],
        );
        if (syllabusAssigned) {
          await pool.query(
            "INSERT INTO course_information(course_id,syllabus_file_id) VALUES($1,$2)",
            [course, syllabus],
          );
        }
        await runMigrations(pool, getMigrationDirectory());
        const service = new CourseResourceService(pool);
        expect((await service.sections(course, user)).data).toEqual([]);
        const page = await service.list(course, user, 100);
        expect(page.data.slice(0, 7).map((r) => r.title)).toEqual([
          "Newest.txt",
          "Legacy link",
          "Older.txt",
          "Old link",
          ".txt",
          "A".repeat(200),
          "Untitled file",
        ]);
        expect(new Set(page.data.map((r) => r.id)).size).toBe(
          4 + awkwardNames.length,
        );
        expect(
          page.data.every(
            (r) => r.sectionId === null && r.visibility === "class",
          ),
        ).toBe(true);
        expect(
          page.data.find((r) => r.kind === "upload" && r.fileId === file)?.id,
        ).toBe(file);
        expect(page.data.find((r) => r.title === "Old link")?.id).toBe(link);
        for (const [id, name, , expectedTitle] of awkwardNames) {
          const resource = page.data.find((r) => r.id === id);
          expect(resource).toMatchObject({
            kind: "upload",
            fileName: name,
            title: expectedTitle,
            sectionId: null,
            visibility: "class",
          });
          expect(resource!.title.trim()).not.toBe("");
          expect([...resource!.title].length).toBeLessThanOrEqual(200);
          const stored = await pool.query<{
            file_name: string;
            object_key: string;
            checksum_sha256: Buffer;
          }>(
            "SELECT file_name,object_key,checksum_sha256 FROM course_files WHERE id=$1",
            [id],
          );
          expect(stored.rows[0]).toMatchObject({
            file_name: name,
            object_key: `legacy/${id}`,
            checksum_sha256: Buffer.alloc(32),
          });
        }
        const migratedLink = page.data.find((r) => r.title === "Legacy link")!;
        const replay = await service.create(
          course,
          user,
          { title: "Legacy link", url: "https://example.edu/legacy" },
          "collision-replay",
        );
        expect(replay.id).toBe(migratedLink.id);
        expect(replay.id).not.toBe(file);
        const app = createApp({
          environment,
          courseResourceService: service,
          authService: {
            session: async () => ({
              id: randomUUID(),
              user: { id: user },
              csrfToken: "csrf",
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            }),
          } as AuthService,
        });
        for (const [key, title] of [
          ["collision-replay", "Legacy link"],
          ["noncollision-replay", "Old link"],
        ]) {
          const response = await request(app)
            .post(`/api/v1/courses/${course}/resources`)
            .set("Cookie", "__Host-chalktalk_session=opaque")
            .set("Origin", environment.frontendBaseUrl)
            .set("X-CSRF-Token", "csrf")
            .set("Idempotency-Key", key)
            .send({ kind: "link", title, url: "https://example.edu/legacy" });
          expect(response.status).toBe(201);
          expect(response.body.data).toEqual(
            page.data.find((r) => r.title === title),
          );
          expect(response.headers.etag).toBe('"v1"');
        }
        const records = await pool.query<{
          key: string;
          scope: string;
          request_hash: Buffer;
          response_body: { id: string };
          expires_at: Date;
        }>(
          "SELECT key,scope,request_hash,response_body,expires_at FROM idempotency_records WHERE key IN ('collision-replay','noncollision-replay','file-replay') ORDER BY key",
        );
        expect(records.rows[0]).toMatchObject({
          key: "collision-replay",
          scope,
          request_hash: hash,
          response_body: { id: migratedLink.id },
        });
        expect(records.rows[0]!.expires_at.toISOString()).toBe(
          "2099-01-01T00:00:00.000Z",
        );
        expect(records.rows[1]).toMatchObject({
          key: "file-replay",
          scope: `course-file-create:${user}:${course}`,
          request_hash: Buffer.alloc(32),
          response_body: { id: file, courseId: course, fileName: "Newest.txt" },
        });
        expect(records.rows[1]!.expires_at.toISOString()).toBe(
          "2099-01-01T00:00:00.000Z",
        );
        expect(records.rows[2]).toMatchObject({
          key: "noncollision-replay",
          scope,
          request_hash: oldHash,
          response_body: { id: link },
        });
        expect(records.rows[2]!.expires_at.toISOString()).toBe(
          "2099-01-01T00:00:00.000Z",
        );
      } finally {
        await pool?.end();
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
        await rm(directory, { recursive: true, force: true });
      }
    });
});
