import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { isValidPassword } from "../auth/crypto.js";
import { convertExport, type PiazzaExport } from "../piazza-import/convert.js";
import {
  importPiazzaCourse,
  piazzaCourseId,
} from "../piazza-import/importer.js";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../database/fixtures/cse416-piazza-export.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as PiazzaExport;

export const CSE416_DEMO = {
  courseId: piazzaCourseId(fixture.network.id),
} as const;

/**
 * Imports the committed CSE 416 Piazza export for `ownerEmail`, the AMS161 demo
 * instructor. It runs only while the course is absent, so restarts keep local
 * edits; run `db:import:piazza --from` to refresh it from the fixture.
 */
export async function seedCse416(
  pool: Pool,
  source: Partial<Record<"MOCK_DATA" | "PIAZZA_DEMO_PASSWORD", string>>,
  ownerEmail: string,
): Promise<"disabled" | "created" | "already-seeded"> {
  if (source.MOCK_DATA !== "true") return "disabled";
  const demoPassword = source.PIAZZA_DEMO_PASSWORD || undefined;
  if (demoPassword !== undefined && !isValidPassword(demoPassword))
    throw new Error(
      "PIAZZA_DEMO_PASSWORD must be 12 to 128 characters when provided",
    );
  const existing = await pool.query("SELECT 1 FROM courses WHERE id=$1", [
    CSE416_DEMO.courseId,
  ]);
  if (existing.rowCount) return "already-seeded";
  await importPiazzaCourse(pool, convertExport(fixture), {
    ownerEmail,
    ...(demoPassword ? { demoPassword } : {}),
  });
  return "created";
}
