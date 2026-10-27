# Identity visibility

Identity-bearing API fields are projections for the authenticated viewer. Clients must not infer permissions from a projection or reuse a projection for another viewer.

## Author

`Author` is used for posts, digest and search results, direct and nested followups, messages, introductory messages, and subchannel creators.

Nonanonymous content returns the author's real `userId` and `displayName`, with `anonymous: false` and `deleted: false`.

Anonymous content viewed by an instructor, TA, or its own author returns the real `userId` and `displayName`, with `anonymous: true` and `deleted: false`.

Anonymous content viewed by another student returns `userId: null`, `displayName: "Anonymous"`, `anonymous: true`, and `deleted: false`.

Deleted authors return `userId: null`, `displayName: "Deleted user"`, and `deleted: true`. The `anonymous` value retains the content's original anonymity setting.

Anonymous messages remain supported. Shared-answer drafts are local until explicitly saved; the API projects anonymous contributor identity according to the viewer's role. No answer presence or cursor data is published.

## Private posts

A private post is readable only by its author and the course's current TAs and instructors; see [Posts](posts.md). For anyone else it is indistinguishable from a post that does not exist, and so are its answers, followups, replies, attachments, upvotes, and live sessions. Lists, search, related questions, and digests remove private posts the viewer cannot read before ranking, pagination, `hasMore`, and counts; [notification visibility](notifications.md) also depends on the event kind. Visibility follows the viewer's current role, so a TA who becomes a student stops seeing other students' private posts at once. Making a post public keeps its anonymity setting, so the author projection rules above still apply.

## Answer contributors

`Answer.contributors` is required but may be `null`. A nonanonymous answer returns its contributor list. An anonymous answer returns the full contributor list to instructors and TAs and returns `null` to every student, including its contributors. Contributors whose accounts are deleted are omitted from every list, so a deleted account's ID is never exposed; the list can therefore be empty.

## Author filtering and search

For `authorId` filters, instructors and TAs may match all content by that author. A student may match the author's nonanonymous content and the student's own anonymous content. Content whose author identity is hidden from the viewer is removed before ranking, before pagination and `hasMore` calculation, and before counts are calculated. An ordinary filter with no visible matches returns `200 OK` with an empty collection.

The `authorRole` filter follows the same rule. Instructors and TAs match every post whose author currently holds the requested role. A student matches only nonanonymous posts and the student's own anonymous posts, so the filter never reveals the role behind someone else's anonymous post.

After an author account is deleted, students cannot match that author's content through `authorId`, including content that was nonanonymous. Staff may still match it, but every returned author projection remains `Deleted user` with a null ID.

The content of an anonymous item remains searchable. Search indexes, ranking explanations, digest entries, counts, and other derived data must not expose a hidden identity.
