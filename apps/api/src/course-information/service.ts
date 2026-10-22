import type { Pool, PoolClient } from "pg";
import { AuthError } from "../auth/errors.js";
import { v7 as uuid } from "uuid";
import type { CourseFileService, NewUpload } from "../course-files/service.js";
import type { CourseFile } from "../course-files/service.js";

export type CourseInformation = {
  courseId: string;
  descriptionMarkdown: string;
  website: string | null;
  syllabus: CourseFile | null;
  version: number;
};
type InformationRow = {
  course_id: string;
  description_markdown: string;
  website: string | null;
  syllabus_file_id: string | null;
  version: number;
};
export type StaffProfile = {
  userId: string;
  displayName: string;
  role: "ta" | "instructor";
  contact: string;
  location: string;
  officeHours: string;
  version: number;
};
export const informationEtag = (value: { version: number }) =>
  `"v${value.version}"`;
const invalid = () =>
  new AuthError(422, "validation_failed", "Course information is invalid");
function text(value: unknown, limit: number): string {
  if (
    typeof value !== "string" ||
    [...value].length > limit ||
    value.includes("\0")
  )
    throw invalid();
  return value;
}
function website(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    [...value].length > 2048 ||
    /[\p{White_Space}\p{Cc}\\]/u.test(value) ||
    !/^https?:\/\//i.test(value)
  )
    throw invalid();
  try {
    const u = new URL(value);
    if (!u.hostname || u.username || u.password) throw Error();
  } catch {
    throw invalid();
  }
  return value;
}
export class CourseInformationService {
  constructor(private readonly pool: Pool) {}
  async authorize(
    db: Pool | PoolClient,
    courseId: string,
    userId: string,
    write = false,
  ) {
    const r = await db.query<{ status: string; role: string }>(
      `SELECT c.status,m.role FROM courses c JOIN course_memberships m ON m.course_id=c.id JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL WHERE c.id=$1 AND m.user_id=$2${write ? " FOR UPDATE OF c,m" : ""}`,
      [courseId, userId],
    );
    const row = r.rows[0];
    if (!row || !["active", "archived"].includes(row.status))
      throw new AuthError(
        write ? 403 : 404,
        write ? "permission_denied" : "not_found",
        "Course is not found",
      );
    if (write && row.role !== "instructor")
      throw new AuthError(
        403,
        "permission_denied",
        "Instructor role is required",
      );
    if (write && row.status !== "active")
      throw new AuthError(409, "course_archived", "Course is archived");
  }
  private async transaction<T>(work: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async project(
    db: Pool | PoolClient,
    courseId: string,
  ): Promise<CourseInformation> {
    const found = await db.query<InformationRow>(
      "SELECT * FROM course_information WHERE course_id=$1",
      [courseId],
    );
    const row = found.rows[0];
    let syllabus: CourseFile | null = null;
    if (row?.syllabus_file_id) {
      const file = await db.query<{
        id: string;
        course_id: string;
        file_name: string;
        media_type: string;
        size_bytes: string;
        created_at: Date;
      }>(
        "SELECT * FROM course_files WHERE course_id=$1 AND id=$2 AND deleted_at IS NULL",
        [courseId, row.syllabus_file_id],
      );
      const f = file.rows[0];
      if (f)
        syllabus = {
          id: f.id,
          courseId: f.course_id,
          fileName: f.file_name,
          mediaType: f.media_type,
          sizeBytes: Number(f.size_bytes),
          createdAt: f.created_at.toISOString(),
        };
    }
    return {
      courseId,
      descriptionMarkdown: row?.description_markdown ?? "",
      website: row?.website ?? null,
      syllabus,
      version: row?.version ?? 1,
    };
  }
  async read(courseId: string, userId: string) {
    return this.transaction(async (db) => {
      await this.authorize(db, courseId, userId);
      return this.project(db, courseId);
    });
  }
  checkVersion(version: number, etag: string | undefined) {
    if (!etag)
      throw new AuthError(428, "precondition_required", "If-Match is required");
    if (etag !== informationEtag({ version }))
      throw new AuthError(
        412,
        "version_conflict",
        "Course information has changed",
      );
  }
  async update(
    courseId: string,
    userId: string,
    input: { descriptionMarkdown: unknown; website: unknown },
    etag: string | undefined,
  ) {
    const description = text(input.descriptionMarkdown, 50000),
      url = website(input.website);
    return this.transaction(async (db) => {
      await this.authorize(db, courseId, userId, true);
      const current = await this.project(db, courseId);
      this.checkVersion(current.version, etag);
      await db.query(
        `INSERT INTO course_information(course_id,description_markdown,website,version) VALUES($1,$2,$3,2) ON CONFLICT(course_id) DO UPDATE SET description_markdown=$2,website=$3,version=course_information.version+1,updated_at=clock_timestamp()`,
        [courseId, description, url],
      );
      return this.project(db, courseId);
    });
  }
  private async staffRows(
    db: Pool | PoolClient,
    courseId: string,
  ): Promise<StaffProfile[]> {
    const result = await db.query<{
      user_id: string;
      display_name: string;
      role: "ta" | "instructor";
      contact: string;
      location: string;
      office_hours: string;
      version: number;
    }>(
      `SELECT m.user_id,u.display_name,m.role,COALESCE(p.contact,'') contact,COALESCE(p.location,'') location,COALESCE(p.office_hours,'') office_hours,COALESCE(p.version,1) version FROM course_memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL LEFT JOIN course_staff_profiles p ON p.course_id=m.course_id AND p.user_id=m.user_id WHERE m.course_id=$1 AND m.role IN ('ta','instructor') ORDER BY CASE WHEN m.role='instructor' THEN 0 ELSE 1 END,u.display_name,m.user_id`,
      [courseId],
    );
    return result.rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      role: r.role,
      contact: r.contact,
      location: r.location,
      officeHours: r.office_hours,
      version: r.version,
    }));
  }
  async staff(courseId: string, userId: string) {
    return this.transaction(async (db) => {
      await this.authorize(db, courseId, userId);
      return this.staffRows(db, courseId);
    });
  }
  async updateStaff(
    courseId: string,
    userId: string,
    targetId: string,
    input: { contact: unknown; location: unknown; officeHours: unknown },
    etag: string | undefined,
  ) {
    const contact = text(input.contact, 2000),
      location = text(input.location, 2000),
      hours = text(input.officeHours, 2000);
    return this.transaction(async (db) => {
      await this.authorize(db, courseId, userId, true);
      const member = await db.query(
        "SELECT 1 FROM course_memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL WHERE m.course_id=$1 AND m.user_id=$2 AND m.role IN ('ta','instructor') FOR UPDATE OF m",
        [courseId, targetId],
      );
      if (!member.rowCount)
        throw new AuthError(404, "not_found", "Staff member is not found");
      const current = (await this.staffRows(db, courseId)).find(
        (r) => r.userId === targetId,
      )!;
      this.checkVersion(current.version, etag);
      await db.query(
        `INSERT INTO course_staff_profiles(course_id,user_id,contact,location,office_hours,version) VALUES($1,$2,$3,$4,$5,2) ON CONFLICT(course_id,user_id) DO UPDATE SET contact=$3,location=$4,office_hours=$5,version=course_staff_profiles.version+1,updated_at=clock_timestamp()`,
        [courseId, targetId, contact, location, hours],
      );
      return (await this.staffRows(db, courseId)).find(
        (r) => r.userId === targetId,
      )!;
    });
  }

  async checkSyllabusWrite(
    courseId: string,
    userId: string,
    etag: string | undefined,
  ) {
    return this.transaction(async (db) => {
      await this.authorize(db, courseId, userId, true);
      this.checkVersion((await this.project(db, courseId)).version, etag);
    });
  }
  private async retire(
    db: PoolClient,
    courseId: string,
    fileId: string | null,
  ) {
    if (!fileId) return;
    const file = await db.query<{ object_key: string }>(
      "SELECT object_key FROM course_files WHERE course_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
      [courseId, fileId],
    );
    if (!file.rows[0]) return;
    if (
      (
        await db.query(
          "SELECT 1 FROM course_information WHERE syllabus_file_id=$1",
          [fileId],
        )
      ).rowCount
    )
      return;
    await db.query(
      "UPDATE course_files SET deleted_at=clock_timestamp() WHERE id=$1",
      [fileId],
    );
    await db.query(
      "INSERT INTO jobs(id,kind,payload,deduplication_key) VALUES($1,'delete_course_file',$2,$3) ON CONFLICT(kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING",
      [
        uuid(),
        { courseId, fileId, objectKey: file.rows[0].object_key },
        `file-delete:${fileId}`,
      ],
    );
  }
  async replaceSyllabus(
    courseId: string,
    userId: string,
    upload: NewUpload,
    etag: string | undefined,
    files: CourseFileService,
  ) {
    await this.checkSyllabusWrite(courseId, userId, etag);
    let value: CourseInformation | undefined;
    await files.create(
      courseId,
      userId,
      upload,
      undefined,
      async (db, file) => {
        await this.authorize(db, courseId, userId, true);
        const current = await this.project(db, courseId);
        this.checkVersion(current.version, etag);
        await db.query(
          `INSERT INTO course_information(course_id,syllabus_file_id,version) VALUES($1,$2,2) ON CONFLICT(course_id) DO UPDATE SET syllabus_file_id=$2,version=course_information.version+1,updated_at=clock_timestamp()`,
          [courseId, file.id],
        );
        await this.retire(db, courseId, current.syllabus?.id ?? null);
        value = await this.project(db, courseId);
      },
    );
    return value!;
  }
  async removeSyllabus(
    courseId: string,
    userId: string,
    etag: string | undefined,
  ) {
    return this.transaction(async (db) => {
      await this.authorize(db, courseId, userId, true);
      const current = await this.project(db, courseId);
      this.checkVersion(current.version, etag);
      if (current.syllabus) {
        await db.query(
          "UPDATE course_information SET syllabus_file_id=NULL,version=version+1,updated_at=clock_timestamp() WHERE course_id=$1",
          [courseId],
        );
        await this.retire(db, courseId, current.syllabus.id);
      }
      return this.project(db, courseId);
    });
  }
}
