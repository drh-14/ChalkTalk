import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v5 as uuidv5, v7 as uuidv7 } from "uuid";
import { AuthError } from "../auth/errors.js";

const MEMBERSHIP_NAMESPACE = "7b174ec2-cfac-4b7c-9d15-67ff4bb54a23";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Course = {
  id: string;
  organizationId: string;
  name: string;
  status: "active" | "archived" | "deleting";
  joinCode: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};
export type Membership = {
  id: string;
  courseId: string;
  user: { id: string; displayName: string };
  role: "student" | "ta" | "instructor";
  createdAt: string;
  updatedAt: string;
  version: number;
};
type CourseRow = {
  id: string;
  organization_id: string;
  name: string;
  status: Course["status"];
  join_code: string;
  created_at: Date;
  updated_at: Date;
  version: number;
};
type MemberRow = {
  course_id: string;
  user_id: string;
  display_name: string;
  role: Membership["role"];
  created_at: Date;
  updated_at: Date;
  version: number;
};
function jsonVersion(value: number | string): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error("Resource version cannot be represented safely in JSON");
  return version;
}
const course = (row: CourseRow, instructor = false): Course => ({
  id: row.id,
  organizationId: row.organization_id,
  name: row.name,
  status: row.status,
  joinCode: instructor ? row.join_code.trim() : null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  version: jsonVersion(row.version),
});
const member = (row: MemberRow): Membership => ({
  id: uuidv5(`${row.course_id}:${row.user_id}`, MEMBERSHIP_NAMESPACE),
  courseId: row.course_id,
  user: { id: row.user_id, displayName: row.display_name },
  role: row.role,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  version: jsonVersion(row.version),
});
export const courseEtag = (value: { version: number }) => `"v${value.version}"`;
const JOIN_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const JOIN_CODE_REJECTION_BOUND = 256 - (256 % JOIN_CODE_ALPHABET.length);
const joinCode = () => {
  let code = "";
  while (code.length < 8) {
    for (const byte of randomBytes(16)) {
      if (byte < JOIN_CODE_REJECTION_BOUND)
        code += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
      if (code.length === 8) break;
    }
  }
  return code;
};
type Page<T> = {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean };
};
type Cursor = {
  createdAt: string;
  id: string;
  filter: string | null;
  scope: string;
};
function decodeCursor(
  value: string | undefined,
  filter: string | undefined,
  scope: string,
): Cursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Cursor;
    if (
      !parsed.createdAt ||
      !parsed.id ||
      parsed.filter !== (filter ?? null) ||
      parsed.scope !== scope ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      !UUID_PATTERN.test(parsed.id)
    )
      throw new Error();
    return parsed;
  } catch {
    throw new AuthError(400, "invalid_request", "Pagination cursor is invalid");
  }
}
function encodeCursor(
  createdAt: string,
  id: string,
  filter: string | undefined,
  scope: string,
): string {
  return Buffer.from(
    JSON.stringify({ createdAt, id, filter: filter ?? null, scope }),
  ).toString("base64url");
}
function page<T extends { createdAt: string; id: string }>(
  rows: T[],
  limit: number,
  filter: string | undefined,
  scope: string,
): Page<T> {
  const data = rows.slice(0, limit);
  const tail = data.at(-1);
  return {
    data,
    page: {
      hasMore: rows.length > limit,
      nextCursor:
        rows.length > limit && tail
          ? encodeCursor(tail.createdAt, tail.id, filter, scope)
          : null,
    },
  };
}

export class CourseService {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async instructor(
    client: Pool | PoolClient,
    courseId: string,
    userId: string,
  ): Promise<boolean> {
    return (
      (
        await client.query(
          "SELECT 1 FROM course_memberships WHERE course_id=$1 AND user_id=$2 AND role='instructor'",
          [courseId, userId],
        )
      ).rowCount === 1
    );
  }
  async organizations(userId: string) {
    const result = await this.pool.query<{
      id: string;
      name: string;
      created_at: Date;
      updated_at: Date;
      version: number;
    }>(
      "SELECT o.id,o.name,o.created_at,o.updated_at,o.version FROM organizations o JOIN users u ON u.organization_id=o.id WHERE u.id=$1 AND u.deleted_at IS NULL",
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      version: jsonVersion(row.version),
    }));
  }
  async create(
    organizationId: string,
    userId: string,
    nameInput: unknown,
  ): Promise<Course> {
    const name = typeof nameInput === "string" ? nameInput.trim() : "";
    if (!name || name.length > 200)
      throw new AuthError(422, "validation_failed", "Course name is invalid");
    return this.tx(async (client) => {
      const allowed = await client.query(
        "SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL",
        [userId, organizationId],
      );
      if (!allowed.rowCount)
        throw new AuthError(404, "not_found", "Organization is not found");
      const result = await client.query<CourseRow>(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,$4,$5) RETURNING id,organization_id,name,status,join_code,created_at,updated_at,version",
        [uuidv7(), organizationId, userId, name, joinCode()],
      );
      const row = result.rows[0]!;
      await client.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor')",
        [row.id, userId],
      );
      return course(row, true);
    });
  }
  async createIdempotently(
    organizationId: string,
    userId: string,
    nameInput: unknown,
    key: string | undefined,
    requestBody: unknown,
  ): Promise<{ value: Course; status: number }> {
    if (key === undefined)
      return {
        value: await this.create(organizationId, userId, nameInput),
        status: 201,
      };
    if (key.length < 1 || key.length > 255)
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is too long",
      );
    const scope = `course-create:${userId}:${organizationId}`;
    const hash = createHash("sha256")
      .update(JSON.stringify(requestBody))
      .digest();
    return this.tx(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [scope, key],
      );
      const prior = await client.query<{
        request_hash: Buffer;
        response_body: Course;
        response_status: number;
      }>(
        "SELECT request_hash,response_body,response_status FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
        [scope, key],
      );
      if (prior.rows[0]) {
        if (!prior.rows[0].request_hash.equals(hash))
          throw new AuthError(
            409,
            "idempotency_key_reused",
            "Idempotency key was used with a different request",
          );
        return {
          value: prior.rows[0].response_body,
          status: prior.rows[0].response_status,
        };
      }
      await client.query(
        "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
        [scope, key],
      );
      const name = typeof nameInput === "string" ? nameInput.trim() : "";
      if (!name || name.length > 200)
        throw new AuthError(422, "validation_failed", "Course name is invalid");
      const allowed = await client.query(
        "SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL",
        [userId, organizationId],
      );
      if (!allowed.rowCount)
        throw new AuthError(404, "not_found", "Organization is not found");
      const inserted = await client.query<CourseRow>(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,$4,$5) RETURNING id,organization_id,name,status,join_code,created_at,updated_at,version",
        [uuidv7(), organizationId, userId, name, joinCode()],
      );
      const value = course(inserted.rows[0]!, true);
      await client.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor')",
        [value.id, userId],
      );
      await client.query(
        "INSERT INTO idempotency_records (scope,key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,201,$4,now()+interval '24 hours')",
        [scope, key, hash, value],
      );
      return { value, status: 201 };
    });
  }
  async list(userId: string, status?: string, limit = 25) {
    const result = await this.pool.query<CourseRow>(
      "SELECT c.id,c.organization_id,c.name,c.status,c.join_code,c.created_at,c.updated_at,c.version FROM courses c JOIN course_memberships m ON m.course_id=c.id WHERE m.user_id=$1 AND ($2::text IS NULL OR c.status=$2) ORDER BY c.created_at DESC LIMIT $3",
      [userId, status ?? null, limit],
    );
    return result.rows.map((row) => course(row, false));
  }
  async listPage(
    userId: string,
    status: string | undefined,
    limit: number,
    cursorValue?: string,
  ): Promise<Page<Course>> {
    const scope = `user-courses:${userId}`;
    const cursor = decodeCursor(cursorValue, status, scope);
    const result = await this.pool.query<CourseRow>(
      "SELECT c.id,c.organization_id,c.name,c.status,c.join_code,c.created_at,c.updated_at,c.version FROM courses c JOIN course_memberships m ON m.course_id=c.id WHERE m.user_id=$1 AND ($2::text IS NULL OR c.status=$2) AND ($3::timestamptz IS NULL OR (c.created_at,c.id) < ($3::timestamptz,$4::uuid)) ORDER BY c.created_at DESC,c.id DESC LIMIT $5",
      [
        userId,
        status ?? null,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );
    return page(
      result.rows.map((row) => course(row, false)),
      limit,
      status,
      scope,
    );
  }
  async listOrganization(
    organizationId: string,
    userId: string,
    status?: string,
    limit = 25,
  ) {
    const allowed = await this.pool.query(
      "SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL",
      [userId, organizationId],
    );
    if (!allowed.rowCount)
      throw new AuthError(404, "not_found", "Organization is not found");
    const result = await this.pool.query<CourseRow>(
      "SELECT id,organization_id,name,status,join_code,created_at,updated_at,version FROM courses WHERE organization_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT $3",
      [organizationId, status ?? null, limit],
    );
    return result.rows.map((row) => course(row, false));
  }
  async listOrganizationPage(
    organizationId: string,
    userId: string,
    status: string | undefined,
    limit: number,
    cursorValue?: string,
  ): Promise<Page<Course>> {
    const scope = `organization-courses:${organizationId}`;
    const cursor = decodeCursor(cursorValue, status, scope);
    const allowed = await this.pool.query(
      "SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL",
      [userId, organizationId],
    );
    if (!allowed.rowCount)
      throw new AuthError(404, "not_found", "Organization is not found");
    const result = await this.pool.query<CourseRow>(
      "SELECT id,organization_id,name,status,join_code,created_at,updated_at,version FROM courses WHERE organization_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5",
      [
        organizationId,
        status ?? null,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );
    return page(
      result.rows.map((row) => course(row, false)),
      limit,
      status,
      scope,
    );
  }
  async get(courseId: string, userId: string): Promise<Course> {
    const result = await this.pool.query<CourseRow & { instructor: boolean }>(
      "SELECT c.id,c.organization_id,c.name,c.status,c.join_code,c.created_at,c.updated_at,c.version, (m.role='instructor') AS instructor FROM courses c JOIN course_memberships m ON m.course_id=c.id WHERE c.id=$1 AND m.user_id=$2",
      [courseId, userId],
    );
    if (!result.rows[0])
      throw new AuthError(404, "not_found", "Course is not found");
    return course(result.rows[0], result.rows[0].instructor);
  }
  async join(
    courseId: string,
    userId: string,
    code: unknown,
  ): Promise<Membership> {
    if (typeof code !== "string" || !/^[A-Z0-9]{8}$/.test(code))
      throw new AuthError(422, "invalid_join_code", "Join code is invalid");
    if (!UUID_PATTERN.test(courseId))
      throw new AuthError(422, "invalid_join_code", "Join code is invalid");
    return this.tx(async (client) => {
      const found = await client.query<CourseRow>(
        "SELECT c.id,c.organization_id,c.name,c.status,c.join_code,c.created_at,c.updated_at,c.version FROM courses c WHERE c.id=$1 FOR UPDATE",
        [courseId],
      );
      const row = found.rows[0];
      if (!row)
        throw new AuthError(422, "invalid_join_code", "Join code is invalid");
      if (row.join_code.trim() !== code)
        throw new AuthError(422, "invalid_join_code", "Join code is invalid");
      if (row.status !== "active")
        throw new AuthError(
          409,
          "course_archived",
          "Course does not accept joins",
        );
      try {
        const inserted = await client.query<MemberRow>(
          "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student') RETURNING course_id,user_id,(SELECT display_name FROM users WHERE id=$2) AS display_name,role,created_at,updated_at,version",
          [courseId, userId],
        );
        return member(inserted.rows[0]!);
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error &&
          "code" in error &&
          error.code === "23505"
        )
          throw new AuthError(
            409,
            "already_member",
            "User is already a member",
          );
        throw error;
      }
    });
  }
  async joinIdempotently(
    courseId: string,
    userId: string,
    code: unknown,
    key: string | undefined,
    requestBody: unknown,
  ): Promise<{ value: Membership; status: number }> {
    if (key === undefined)
      return { value: await this.join(courseId, userId, code), status: 201 };
    if (key.length < 1 || key.length > 255)
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is too long",
      );
    const scope = `course-join:${userId}:${courseId}`;
    const hash = createHash("sha256")
      .update(JSON.stringify(requestBody))
      .digest();
    return this.tx(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [scope, key],
      );
      const prior = await client.query<{
        request_hash: Buffer;
        response_body: Membership;
        response_status: number;
      }>(
        "SELECT request_hash,response_body,response_status FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
        [scope, key],
      );
      if (prior.rows[0]) {
        if (!prior.rows[0].request_hash.equals(hash))
          throw new AuthError(
            409,
            "idempotency_key_reused",
            "Idempotency key was used with a different request",
          );
        return {
          value: prior.rows[0].response_body,
          status: prior.rows[0].response_status,
        };
      }
      await client.query(
        "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
        [scope, key],
      );
      if (typeof code !== "string" || !/^[A-Z0-9]{8}$/.test(code))
        throw new AuthError(422, "invalid_join_code", "Join code is invalid");
      if (!UUID_PATTERN.test(courseId))
        throw new AuthError(422, "invalid_join_code", "Join code is invalid");
      const found = await client.query<CourseRow>(
        "SELECT c.id,c.organization_id,c.name,c.status,c.join_code,c.created_at,c.updated_at,c.version FROM courses c WHERE c.id=$1 FOR UPDATE",
        [courseId],
      );
      const row = found.rows[0];
      if (!row)
        throw new AuthError(422, "invalid_join_code", "Join code is invalid");
      if (row.join_code.trim() !== code)
        throw new AuthError(422, "invalid_join_code", "Join code is invalid");
      if (row.status !== "active")
        throw new AuthError(
          409,
          "course_archived",
          "Course does not accept joins",
        );
      try {
        const inserted = await client.query<MemberRow>(
          "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student') RETURNING course_id,user_id,(SELECT display_name FROM users WHERE id=$2) AS display_name,role,created_at,updated_at,version",
          [courseId, userId],
        );
        const value = member(inserted.rows[0]!);
        await client.query(
          "INSERT INTO idempotency_records (scope,key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,201,$4,now()+interval '24 hours')",
          [scope, key, hash, value],
        );
        return { value, status: 201 };
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error &&
          "code" in error &&
          error.code === "23505"
        )
          throw new AuthError(
            409,
            "already_member",
            "User is already a member",
          );
        throw error;
      }
    });
  }
  async members(
    courseId: string,
    userId: string,
    role?: string,
    limit = 25,
  ): Promise<Membership[]> {
    await this.get(courseId, userId);
    const result = await this.pool.query<MemberRow>(
      "SELECT m.course_id,m.user_id,u.display_name,m.role,m.created_at,m.updated_at,m.version FROM course_memberships m JOIN users u ON u.id=m.user_id WHERE m.course_id=$1 AND ($2::text IS NULL OR m.role=$2) ORDER BY m.created_at LIMIT $3",
      [courseId, role ?? null, limit],
    );
    return result.rows.map(member);
  }
  async getMember(
    courseId: string,
    userId: string,
    targetUserId: string,
  ): Promise<Membership> {
    await this.get(courseId, userId);
    const result = await this.pool.query<MemberRow>(
      "SELECT m.course_id,m.user_id,u.display_name,m.role,m.created_at,m.updated_at,m.version FROM course_memberships m JOIN users u ON u.id=m.user_id WHERE m.course_id=$1 AND m.user_id=$2",
      [courseId, targetUserId],
    );
    if (!result.rows[0])
      throw new AuthError(404, "not_found", "Membership is not found");
    return member(result.rows[0]);
  }
  async membersPage(
    courseId: string,
    userId: string,
    role: string | undefined,
    limit: number,
    cursorValue?: string,
  ): Promise<Page<Membership>> {
    const scope = `course-members:${courseId}`;
    const cursor = decodeCursor(cursorValue, role, scope);
    await this.get(courseId, userId);
    const rows = await this.pool.query<MemberRow>(
      "SELECT m.course_id,m.user_id,u.display_name,m.role,m.created_at,m.updated_at,m.version FROM course_memberships m JOIN users u ON u.id=m.user_id WHERE m.course_id=$1 AND ($2::text IS NULL OR m.role=$2) AND ($3::timestamptz IS NULL OR (m.created_at,m.user_id)<($3::timestamptz,$4::uuid)) ORDER BY m.created_at DESC,m.user_id DESC LIMIT $5",
      [
        courseId,
        role ?? null,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );
    const data = rows.rows.slice(0, limit).map(member);
    const tail = rows.rows.slice(0, limit).at(-1);
    return {
      data,
      page: {
        hasMore: rows.rows.length > limit,
        nextCursor:
          rows.rows.length > limit && tail
            ? encodeCursor(
                tail.created_at.toISOString(),
                tail.user_id,
                role,
                scope,
              )
            : null,
      },
    };
  }
  async update(
    courseId: string,
    userId: string,
    ifMatch: string | undefined,
    input: { name?: unknown; status?: unknown },
  ): Promise<Course> {
    return this.tx(async (client) => {
      const found = await client.query<CourseRow>(
        "SELECT id,organization_id,name,status,join_code,created_at,updated_at,version FROM courses WHERE id=$1 FOR UPDATE",
        [courseId],
      );
      const existing = found.rows[0];
      if (!existing || !(await this.instructor(client, courseId, userId)))
        throw new AuthError(404, "not_found", "Course is not found");
      if (existing.status === "deleting")
        throw new AuthError(
          409,
          "course_deleting",
          "Course deletion is in progress",
        );
      if (!ifMatch)
        throw new AuthError(
          428,
          "precondition_required",
          "If-Match is required",
        );
      if (ifMatch !== courseEtag(existing))
        throw new AuthError(412, "version_conflict", "Course has changed");
      const name =
        input.name === undefined
          ? existing.name
          : typeof input.name === "string" &&
              input.name.trim() &&
              input.name.trim().length <= 200
            ? input.name.trim()
            : null;
      const status =
        input.status === undefined
          ? existing.status
          : input.status === "active" || input.status === "archived"
            ? input.status
            : null;
      if (
        !name ||
        !status ||
        (input.name === undefined && input.status === undefined)
      )
        throw new AuthError(
          422,
          "validation_failed",
          "Course update is invalid",
        );
      const result = await client.query<CourseRow>(
        "UPDATE courses SET name=$1,status=$2,version=version+1,updated_at=now() WHERE id=$3 RETURNING id,organization_id,name,status,join_code,created_at,updated_at,version",
        [name, status, courseId],
      );
      return course(result.rows[0]!, true);
    });
  }
  async updateMember(
    courseId: string,
    actorId: string,
    targetId: string,
    ifMatch: string | undefined,
    role: unknown,
  ): Promise<Membership> {
    if (role !== "student" && role !== "ta" && role !== "instructor")
      throw new AuthError(422, "validation_failed", "Role is invalid");
    return this.tx(async (client) => {
      const locked = await client.query<{
        id: string;
        status: Course["status"];
      }>("SELECT id,status FROM courses WHERE id=$1 FOR UPDATE", [courseId]);
      if (
        !locked.rowCount ||
        !(await this.instructor(client, courseId, actorId))
      )
        throw new AuthError(404, "not_found", "Membership is not found");
      const current = await client.query<MemberRow>(
        "SELECT m.course_id,m.user_id,u.display_name,m.role,m.created_at,m.updated_at,m.version FROM course_memberships m JOIN users u ON u.id=m.user_id WHERE m.course_id=$1 AND m.user_id=$2",
        [courseId, targetId],
      );
      const row = current.rows[0];
      if (!row)
        throw new AuthError(404, "not_found", "Membership is not found");
      if (!ifMatch)
        throw new AuthError(
          428,
          "precondition_required",
          "If-Match is required",
        );
      if (ifMatch !== courseEtag(row))
        throw new AuthError(412, "version_conflict", "Membership has changed");
      if (actorId === targetId)
        throw new AuthError(
          403,
          "permission_denied",
          "You cannot change your own membership",
        );
      if (row.role === "instructor" && role !== "instructor") {
        const count = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM course_memberships WHERE course_id=$1 AND role='instructor'",
          [courseId],
        );
        if (Number(count.rows[0]!.count) === 1)
          throw new AuthError(
            409,
            "last_instructor",
            "Course must retain an instructor",
          );
      }
      const updated = await client.query<MemberRow>(
        "UPDATE course_memberships m SET role=$1,version=m.version+1,updated_at=now() FROM users u WHERE m.course_id=$2 AND m.user_id=$3 AND u.id=m.user_id RETURNING m.course_id,m.user_id,u.display_name,m.role,m.created_at,m.updated_at,m.version",
        [role, courseId, targetId],
      );
      return member(updated.rows[0]!);
    });
  }
  async removeMember(
    courseId: string,
    actorId: string,
    targetId: string,
    ifMatch?: string,
    selfLeave = false,
  ): Promise<void> {
    return this.tx(async (client) => {
      const locked = await client.query<{
        id: string;
        status: Course["status"];
      }>("SELECT id,status FROM courses WHERE id=$1 FOR UPDATE", [courseId]);
      const actor = await this.instructor(client, courseId, actorId);
      if (
        !locked.rowCount ||
        (!selfLeave && !actor) ||
        (selfLeave && targetId !== actorId)
      )
        throw new AuthError(404, "not_found", "Membership is not found");
      if (selfLeave && locked.rows[0]!.status === "deleting")
        throw new AuthError(
          409,
          "course_deleting",
          "Course deletion is in progress",
        );
      const existing = await client.query<MemberRow>(
        "SELECT m.course_id,m.user_id,u.display_name,m.role,m.created_at,m.updated_at,m.version FROM course_memberships m JOIN users u ON u.id=m.user_id WHERE m.course_id=$1 AND m.user_id=$2",
        [courseId, targetId],
      );
      const row = existing.rows[0];
      if (!row)
        throw new AuthError(404, "not_found", "Membership is not found");
      if (!selfLeave) {
        if (!ifMatch)
          throw new AuthError(
            428,
            "precondition_required",
            "If-Match is required",
          );
        if (ifMatch !== courseEtag(row))
          throw new AuthError(
            412,
            "version_conflict",
            "Membership has changed",
          );
        if (actorId === targetId)
          throw new AuthError(
            403,
            "permission_denied",
            "You cannot remove your own membership here",
          );
      }
      if (row.role === "instructor") {
        const count = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM course_memberships WHERE course_id=$1 AND role='instructor'",
          [courseId],
        );
        if (Number(count.rows[0]!.count) === 1)
          throw new AuthError(
            409,
            "last_instructor",
            "Course must retain an instructor",
          );
      }
      await client.query(
        "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
        [courseId, targetId],
      );
    });
  }
  async delete(
    courseId: string,
    userId: string,
    ifMatch: string | undefined,
  ): Promise<Course> {
    return this.tx(async (client) => {
      const found = await client.query<CourseRow>(
        "SELECT id,organization_id,name,status,join_code,created_at,updated_at,version FROM courses WHERE id=$1 FOR UPDATE",
        [courseId],
      );
      const existing = found.rows[0];
      if (!existing || !(await this.instructor(client, courseId, userId)))
        throw new AuthError(404, "not_found", "Course is not found");
      if (existing.status === "deleting")
        throw new AuthError(
          409,
          "course_deleting",
          "Course deletion is already in progress",
        );
      if (!ifMatch)
        throw new AuthError(
          428,
          "precondition_required",
          "If-Match is required",
        );
      if (ifMatch !== courseEtag(existing))
        throw new AuthError(412, "version_conflict", "Course has changed");
      const result = await client.query<CourseRow>(
        "UPDATE courses SET status='deleting',version=version+1,updated_at=now() WHERE id=$1 RETURNING id,organization_id,name,status,join_code,created_at,updated_at,version",
        [courseId],
      );
      await client.query(
        "INSERT INTO jobs (id,kind,payload,deduplication_key) VALUES ($1,'delete_course',$2,$3) ON CONFLICT (kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING",
        [uuidv7(), { courseId }, `course-delete:${courseId}`],
      );
      return course(result.rows[0]!, true);
    });
  }
}
