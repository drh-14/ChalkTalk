# Design

Keep one nullable `posts.folder_id`. Accept up to 100 UUID or `unfiled` values as repeated `folder` parameters; normalize UUID case and sort/deduplicate values before the cursor binding. SQL matches `folder_id = ANY(uuid[])` and optionally `folder_id IS NULL` under the existing visibility predicate and before pagination. The browser preserves repeated params and renders a checkbox group; empty selection omits the parameter. Folder deletion replaces a selected deleted ID with `unfiled` while preserving other selections. No new dependency or data ownership change.
