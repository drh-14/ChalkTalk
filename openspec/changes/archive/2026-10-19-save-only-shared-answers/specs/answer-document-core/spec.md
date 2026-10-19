## REMOVED Requirements

### Requirement: Active answers have a durable Yjs text document

Removed because active answer bodies use Markdown rows and explicit REST saves rather than a Yjs document.

### Requirement: Updates merge and persist atomically

Removed because unsaved answer drafts are independent, not merged CRDT updates.

### Requirement: Invalid or inactive writes cannot change answer content

Removed with the retired Yjs update API; REST authorization, validation, and stale-write checks remain in the question-answers contract.
