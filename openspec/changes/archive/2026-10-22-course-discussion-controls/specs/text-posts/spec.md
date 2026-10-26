## ADDED Requirements

### Requirement: New posts obey current course discussion policy

A new post requesting `anonymous: true` SHALL be rejected with `409 anonymous_posting_disabled` when the course disallows anonymity. A new post requesting `private: true` SHALL be rejected with `409 private_posting_disabled` when the course disallows private posting. The policy check SHALL serialize against instructor updates and SHALL occur only after a matching successful idempotent retry has been recognized. Existing posts SHALL retain their anonymity and privacy, remain readable/editable under their existing authorization rules, and may be made less private. An edit SHALL NOT newly enable anonymity when the current course policy disallows it.

#### Scenario: Student creates an anonymous post after disablement
- **WHEN** a member creates a valid post with `anonymous: true` after anonymity is disabled
- **THEN** the API returns `409 anonymous_posting_disabled` without creating a post

#### Scenario: Existing private post remains private
- **WHEN** an instructor disables private posting after a private post exists
- **THEN** the post remains private and authorized readers can still read and edit it

#### Scenario: Idempotent replay after disablement
- **WHEN** a successful post creation is retried with the same key and body after the policy is disabled
- **THEN** the original successful response is replayed and no second post is created
