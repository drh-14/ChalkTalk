import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { isValidPassword } from "../auth/crypto.js";
import { convertExport, type PiazzaExport } from "../piazza-import/convert.js";
import {
  importPiazzaCourse,
  piazzaCourseId,
} from "../piazza-import/importer.js";

const demoCourse = (label: string, file: string) => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(`../../../../database/fixtures/${file}`, import.meta.url),
      "utf8",
    ),
  ) as PiazzaExport;
  return { label, fixture, courseId: piazzaCourseId(fixture.network.id) };
};

/** Real Piazza classes committed as demo fixtures, seeded in this order. */
export const PIAZZA_DEMO_COURSES = [
  demoCourse("CSE 416", "cse416-piazza-export.json"),
  demoCourse("CSE 214", "cse214-piazza-export.json"),
] as const;
export const [CSE416_DEMO, CSE214_DEMO] = PIAZZA_DEMO_COURSES;

/**
 * Imports each committed Piazza export for `ownerEmail`, the AMS161 demo
 * instructor. A course is imported only while it is absent, so restarts keep
 * local edits; run `db:import:piazza --from` to refresh one from its fixture.
 */
export async function seedPiazzaCourses(
  pool: Pool,
  source: Partial<Record<"MOCK_DATA" | "PIAZZA_DEMO_PASSWORD", string>>,
  ownerEmail: string,
): Promise<
  "disabled" | { label: string; result: "created" | "already-seeded" }[]
> {
  if (source.MOCK_DATA !== "true") return "disabled";
  const demoPassword = source.PIAZZA_DEMO_PASSWORD || undefined;
  if (demoPassword !== undefined && !isValidPassword(demoPassword))
    throw new Error(
      "PIAZZA_DEMO_PASSWORD must be 12 to 128 characters when provided",
    );
  const results = [];
  for (const course of PIAZZA_DEMO_COURSES) {
    const existing = await pool.query("SELECT 1 FROM courses WHERE id=$1", [
      course.courseId,
    ]);
    if (existing.rowCount) {
      results.push({ label: course.label, result: "already-seeded" as const });
      continue;
    }
    await importPiazzaCourse(pool, convertExport(course.fixture), {
      ownerEmail,
      ...(demoPassword ? { demoPassword } : {}),
    });
    results.push({ label: course.label, result: "created" as const });
  }
  return results;
}
