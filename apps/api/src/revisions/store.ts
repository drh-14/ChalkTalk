import type { Pool, PoolClient } from "pg";

export type RevisionKind = "post" | "answer" | "followup";
type Db = Pool | PoolClient;

/** Call while holding the content row's write lock, in the content transaction. */
export async function appendTextRevision(
  db: PoolClient,
  kind: RevisionKind,
  resourceId: string,
  editorId: string | null,
  restoredFrom?: string,
): Promise<void> {
  const table =
    kind === "post" ? "posts" : kind === "answer" ? "answers" : "followups";
  await db.query(
    `INSERT INTO content_text_revisions
       (course_id,kind,resource_id,ordinal,resource_version,editor_user_id,title,body_markdown,anonymous,restored_from_revision_id)
     SELECT r.course_id,$2,r.id,
       coalesce((SELECT max(ordinal)+1 FROM content_text_revisions WHERE kind=$2 AND resource_id=$1),1),
       r.version,$3,${kind === "post" ? "r.title" : "NULL"},r.body_markdown,r.anonymous,$4
     FROM ${table} r WHERE r.id=$1 AND r.deleted_at IS NULL`,
    [resourceId, kind, editorId, restoredFrom ?? null],
  );
}

export async function purgeTextRevisions(
  db: PoolClient,
  kind: RevisionKind,
  id: string,
): Promise<void> {
  await db.query(
    "DELETE FROM content_text_revisions WHERE kind=$1 AND resource_id=$2",
    [kind, id],
  );
}

export type TextRevision = {
  id: string;
  ordinal: number;
  resourceVersion: number;
  createdAt: string;
  title: string | null;
  bodyMarkdown: string;
  baseline: boolean;
  restoredFromRevisionId: string | null;
  editor: { id: string; displayName: string } | null;
};
export type TextRevisionMetadata = Omit<TextRevision, "title" | "bodyMarkdown">;
export type TextRevisionPage = {
  data: TextRevisionMetadata[];
  page: { nextCursor: string | null };
};

type RevisionRow = {
  id: string;
  ordinal: string;
  resource_version: string;
  created_at: Date;
  title: string | null;
  body_markdown: string;
  baseline: boolean;
  anonymous: boolean;
  restored_from_revision_id: string | null;
  editor_user_id: string | null;
  display_name: string | null;
  deleted_at: Date | null;
};

function projectRevision(
  row: RevisionRow,
  staff: boolean,
): TextRevisionMetadata {
  return {
    id: row.id,
    ordinal: Number(row.ordinal),
    resourceVersion: Number(row.resource_version),
    createdAt: row.created_at.toISOString(),
    baseline: row.baseline,
    restoredFromRevisionId: row.restored_from_revision_id,
    editor:
      (staff || !row.anonymous) &&
      row.editor_user_id &&
      row.display_name &&
      !row.deleted_at
        ? { id: row.editor_user_id, displayName: row.display_name }
        : null,
  };
}

export async function listTextRevisions(
  db: Db,
  kind: RevisionKind,
  resourceId: string,
  staff: boolean,
  cursor = 0,
): Promise<TextRevisionPage> {
  const result = await db.query<RevisionRow>(
    `SELECT r.id,r.ordinal,r.resource_version,r.created_at,r.baseline,r.anonymous,
            r.restored_from_revision_id,r.editor_user_id,u.display_name,u.deleted_at
     FROM content_text_revisions r
     LEFT JOIN users u ON u.id=r.editor_user_id
     WHERE r.kind=$1 AND r.resource_id=$2 AND r.ordinal>$3
     ORDER BY r.ordinal LIMIT 51`,
    [kind, resourceId, cursor],
  );
  const rows = result.rows.slice(0, 50);
  return {
    data: rows.map((row) => projectRevision(row, staff)),
    page: {
      nextCursor:
        result.rows.length > 50 ? rows[rows.length - 1].ordinal : null,
    },
  };
}

export async function getTextRevisions(
  db: Db,
  kind: RevisionKind,
  resourceId: string,
  ids: string[],
  staff: boolean,
): Promise<TextRevision[]> {
  const result = await db.query<RevisionRow>(
    `SELECT r.*,u.display_name,u.deleted_at FROM content_text_revisions r
     LEFT JOIN users u ON u.id=r.editor_user_id
     WHERE r.kind=$1 AND r.resource_id=$2 AND r.id=ANY($3::uuid[])`,
    [kind, resourceId, ids],
  );
  return result.rows.map((row) => ({
    ...projectRevision(row, staff),
    title: row.title,
    bodyMarkdown: row.body_markdown,
  }));
}
