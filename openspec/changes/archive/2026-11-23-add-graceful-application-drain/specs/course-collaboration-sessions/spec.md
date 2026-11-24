## ADDED Requirements

### Requirement: Process drain preserves the final frozen collaboration state

On process drain the collaboration server SHALL synchronously freeze new edit admission, settle handlers admitted before cutoff and admission transactions, prevent later buffered frames from applying, and confirm persistence of each loaded document's exact final frozen Yjs state and projection before destruction. Pending/debounced stores SHALL be serialized so an older store cannot overwrite the final state. Unconfirmed persistence and required callback/closure failure SHALL propagate to failed drain. A confirmed final save MAY resolve an earlier recoverable store failure for that same frozen version. Shutdown SHALL NOT itself end the user session or set final_snapshot_confirmed. Transient restart disconnection SHALL NOT masquerade as session-ended or access-removed and SHALL preserve existing fresh-ticket reconnect and unconfirmed-local-edit behavior; it SHALL NOT introduce a new per-edit durable acknowledgement guarantee.

#### Scenario: Authorized edit crosses the cutoff

- **WHEN** an authorized handler admitted before cutoff applies an edit after drain begins
- **THEN** drain waits for it and confirms that edit in the final frozen persisted document before destroying it

#### Scenario: Buffered late frame and delayed older save

- **WHEN** a frame not admitted at cutoff is buffered and an older store is still pending
- **THEN** the late frame is not applied and the older store cannot overwrite the confirmed final frozen version

#### Scenario: Final save fails

- **WHEN** the final frozen document cannot be confirmed in the database
- **THEN** drain fails closed and cannot publish success merely because sockets closed or destroy resolved

#### Scenario: Process restart does not end the session

- **WHEN** an active session's process drains successfully and a fresh process starts
- **THEN** the session remains active with unchanged final_snapshot_confirmed, its server-accepted cutoff state reloads, and authorized clients reconnect using fresh tickets without an ended-session screen

### Requirement: Transient ticket refresh preserves reconnecting ownership

A transient network failure or HTTP 503 while obtaining a fresh collaboration
connection ticket SHALL preserve the current local Yjs document and existing
Reconnecting UI, retry with a newly issued ticket after a bounded delay, and SHALL
NOT replay a consumed/stale ticket or classify transient failure as access removal.
Disposal/session change SHALL cancel the retry and prevent late connection use.
Permanent authentication/authorization errors and explicit session-ended/access-removed
signals SHALL retain their existing terminal behavior. No styling or new UI state
is introduced. This narrow behavior correction was explicitly approved by the user
on 2026-11-23 after the real-browser transient-503 test failed.

#### Scenario: Fresh ticket endpoint is temporarily unavailable

- **WHEN** an established session disconnects for service restart and ticket refresh returns 503 or a network failure
- **THEN** local text and Reconnecting UI remain, no ended/removed state appears, and a later successful refresh uses its newly issued ticket to reconnect

#### Scenario: Retry is canceled or access really changes

- **WHEN** the view is disposed or changes session during retry, or refresh returns a permanent authentication/authorization/session-ended error
- **THEN** canceled retries cannot reopen the old session, and permanent errors retain the documented terminal classification without stale-ticket reuse
