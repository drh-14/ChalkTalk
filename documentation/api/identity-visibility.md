# Identity visibility

Identity-bearing API fields are projections for the authenticated viewer. Clients must not infer permissions from a projection or reuse a projection for another viewer.

## Author

`Author` is used for posts, digest and search results, direct and nested followups, messages, introductory messages, and subchannel creators.

- Nonanonymous content returns the author's real `userId` and `displayName`, with `anonymous: false` and `deleted: false`.
- Anonymous content viewed by an instructor, TA, or its own author returns the real `userId` and `displayName`, with `anonymous: true` and `deleted: false`.
- Anonymous content viewed by another student returns `userId: null`, `displayName: "Anonymous"`, `anonymous: true`, and `deleted: false`.
- Deleted authors return `userId: null`, `displayName: "Deleted user"`, and `deleted: true`. The `anonymous` value retains the content's original anonymity setting.

Anonymous messages remain supported. Live collaboration presence is intentionally named and follows the separate [collaboration WebSocket contract](collaboration-websocket.md).

## Answer contributors

`Answer.contributors` is required but may be `null`. A nonanonymous answer returns its contributor list. An anonymous answer returns the full contributor list to instructors and TAs and returns `null` to every student, including its contributors.

## Author filtering and search

For `authorId` filters, instructors and TAs may match all content by that author. A student may match the author's nonanonymous content and the student's own anonymous content. Content whose author identity is hidden from the viewer is removed before ranking, before pagination and `hasMore` calculation, and before counts are calculated. An ordinary filter with no visible matches returns `200 OK` with an empty collection.

The content of an anonymous item remains searchable. Search indexes, ranking explanations, digest entries, counts, and other derived data must not expose a hidden identity.
