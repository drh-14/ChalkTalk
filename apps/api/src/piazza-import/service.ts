import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { convertExport } from "./convert.js";
import { importPiazzaCourse } from "./importer.js";
import { parsePiazzaUpload } from "./upload.js";

/** Server-side boundary for a user-supplied CLI-generated Piazza JSON file. */
export class PiazzaImportService {
  constructor(private readonly pool: Pool) {}

  async importFile(filePath: string, actor: { id: string; email: string }) {
    const parsed = parsePiazzaUpload(await readFile(filePath, "utf8"));
    const summary = await importPiazzaCourse(
      this.pool,
      convertExport(parsed.data),
      { ownerEmail: actor.email, uiActorId: actor.id },
    );
    return {
      courseId: summary.courseId,
      courseName: summary.courseName,
      omittedPrivatePosts: parsed.omittedPrivatePosts,
      posts: summary.posts,
      answers: summary.answers,
      followups: summary.followups,
    };
  }
}
