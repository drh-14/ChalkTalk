# Design

## Context

- **Writes and notifications.** Post, answer, and followup writes already call `recordActivity(db, { courseId, postId, actorId, kind, anonymous, follow })` inside their transaction. It notifies followers who can still read the post and queues emails for those who opted in.
- **Editor.** Every Markdown body uses `MarkdownEditorField`, which wraps a CodeMirror 6 `PostEditor`. `@codemirror/autocomplete` 6.20.3 is already installed as a dependency of the language packages.
- **Rendering.** `PostBody` renders Markdown with `react-markdown` and `rehype-sanitize`. The default sanitize schema strips unknown URL protocols such as `mention:`.
- **Roster.** Any course member can already list course members (`GET /courses/{id}/members`), so suggestions reveal nothing new.

## Decisions

### D1. Token format and parsing

- **Token.** `[@label](mention:<uuid>)` is ordinary Markdown link syntax, so it survives editors, previews, and search. The label is what readers see, and notifications use the user's real current name.
- **Parsing.** `apps/api/src/notifications/mentions.ts` exports `parseMentions(markdown)`, which returns `{ userIds: string[]; staff: boolean }`:
  - it removes fenced code blocks and inline code spans first;
  - it collects unique UUIDs from `[@…](mention:<uuid>)`;
  - it detects `@staff` as a whole word.
- **Limit.** More than 20 unique user IDs throws `422 too_many_mentions`, before anything is written.

### D2. Recording

`recordActivity` gains `mentions?: { userIds: string[]; staff: boolean }`, already reduced to new mentions on edits.

- **Recipients.** The mention recipients are:
  - those users, plus every current TA and instructor when `staff` is set;
  - joined to current memberships and non-deleted users;
  - filtered by `readablePost`;
  - excluding the actor.
- **Kind and anonymity.** It inserts `kind='mentioned'` notifications, with `actor_anonymous` taken from the content's anonymity.
- **Dedupe.** The follower fan-out for the same write excludes users who were just given a mention notification.
- **Email.** Email jobs are queued for mention recipients who opted in, exactly as for other kinds.
- **Mention-only writes.** Writes that do not otherwise notify, such as a post edit or a followup edit, call `recordActivity` with no `kind` and only `mentions`.

### D3. Write paths

For each, the service parses the new body; for edits it also parses the old body and passes only the new mentions.

- `PostService.create` and `update`, when `bodyMarkdown` changes;
- `AnswerService.create` and `edit`;
- `FollowupService.create` and `edit`.

### D4. Suggestions

`GET /api/v1/courses/{courseId}/mention-suggestions` accepts `q` (0–50 characters) and an optional `postId`.

- It requires membership, otherwise `404 not_found`.
- It matches `display_name ILIKE '%' || q || '%'`, with `%` and `_` escaped, and returns at most 8 rows, ordered by prefix match and then name.
- It excludes the caller and deleted users.
- With a `postId` that the caller can read, it filters candidates through `readablePost` using each candidate's role. An unreadable `postId` returns `404`.

### D5. Web

- **Editor.** `PostEditor` takes an optional `mentions` source, `(query) => Promise<Suggestion[]>`, and adds the `@codemirror/autocomplete` extension:
  - it activates on `@` followed by word characters;
  - it lists **@staff** first, then members as "Name · Role";
  - applying a member inserts `[@Name](mention:<id>) `, and **@staff** inserts `@staff `.
- **Wiring.** `MarkdownEditorField` forwards the source. The post composer, post editor, and answer and followup composers build it from `courseId` and the post ID when they have one.
- **Rendering.**
  - `PostBody` extends the sanitize schema to allow the `mention` protocol on links;
  - an `a` component renders `mention:` links as `<span class="mention">@label</span>`;
  - `@staff` stays plain text.
- **Dependency.** `@codemirror/autocomplete` becomes a direct web dependency, at its installed 6.20.x version.

### D6. Worker and bell

- **Email.** Subject `[course] You were mentioned on "<title>"`, and text `<actor> mentioned you on "<title>" in <course>.`
- **Bell.** "<actor> mentioned you on <title>".

## Risks / Trade-offs

- **[A label can say any name]** → Notifications and suggestions always use the real name. A misleading label is no worse than typing any text, and the token's ID still points to the real person.
- **[@staff noise in large courses]** → It pings each staff member once per write, at most, and staff can unfollow, but not mute, mentions. If needed, a per-course mute can come later.
- **[Editing out and back in a mention re-notifies]** → Edits compare only with the previous body. This is accepted for simplicity.

## Migration Plan

Migration 028 drops and re-adds the `notifications.kind` check with `mentioned` added. Rolling back deletes `mentioned` notifications and restores the check.
