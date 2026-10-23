/** Catalog-backed file reads must use current same-course membership, including legacy URLs. */
export const readableCatalogFile = (
  fileAlias: string,
  userParameter: string,
) => `(
 EXISTS(SELECT 1 FROM course_memberships access_m JOIN users access_u ON access_u.id=access_m.user_id AND access_u.deleted_at IS NULL JOIN courses access_c ON access_c.id=access_m.course_id AND access_c.status IN ('active','archived') WHERE access_m.course_id=${fileAlias}.course_id AND access_m.user_id=${userParameter}) AND (
 NOT EXISTS (SELECT 1 FROM course_resource_revisions crv WHERE crv.file_id=${fileAlias}.id)
 OR EXISTS (
 SELECT 1 FROM course_resource_revisions crv JOIN course_resources cr ON cr.active_revision_id=crv.id AND cr.id=crv.resource_id AND cr.course_id=${fileAlias}.course_id
 LEFT JOIN course_resource_sections crs ON crs.id=cr.section_id
 JOIN course_memberships crm ON crm.course_id=cr.course_id AND crm.user_id=${userParameter}
 JOIN users cru ON cru.id=crm.user_id AND cru.deleted_at IS NULL
 WHERE crv.file_id=${fileAlias}.id AND cr.deleted_at IS NULL AND (crm.role IN ('ta','instructor') OR (cr.visibility='class' AND COALESCE(crs.visibility,'class')='class'))
 )))`;
