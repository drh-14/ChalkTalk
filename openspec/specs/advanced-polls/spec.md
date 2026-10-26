# advanced-polls Specification

## Purpose
Extend the existing course poll contract with configurable ballots, closing and result release, while preserving private voter identity and backward compatibility with basic polls.

## Requirements

### Requirement: Staff configure advanced polls without breaking basic polls

Current course TAs and instructors SHALL be able to create a poll with 2–10 immutable options, either single-select or multi-select, a maximum number of choices in the range 2 through its option count for multi-select, an optional future close time, an optional results explanation, and either manual or automatic-on-close result release. New multi-select polls SHALL require an explicit manual or automatic-on-close release mode and SHALL NOT use live release. Single-select SHALL allow exactly one choice and have a maximum of one. Omitted advanced fields SHALL preserve basic poll creation behavior: single-select, no deadline, open, with live results visible to all course members. Students SHALL remain unable to create polls; polls SHALL remain public and unable to receive answers or followups. New configuration validation failures SHALL not create a post. Existing polls SHALL behave as basic polls after migration.

A provided close time SHALL name a real calendar date, include an explicit `Z` or numeric timezone offset, and be stored as the same unambiguous instant; offset-free or nonexistent dates SHALL be rejected.

Every persisted poll SHALL have a settings row, including migrated basic polls; a missing row SHALL fail as an invariant error rather than defaulting to live, open results.

An exact keyed create retry SHALL return the current authorized poll projection after its deadline passes; a new create with a past deadline SHALL fail.

#### Scenario: A staff member creates a multi-select poll
- **WHEN** a TA creates a poll with four options, multi-select, a maximum of two, a future deadline, and automatic release
- **THEN** the poll reports those settings, starts open and unreleased, and has no ballots

#### Scenario: An old client creates a poll
- **WHEN** a TA creates a poll with only the pre-existing basic fields
- **THEN** it is single-select, open, has no deadline, and its aggregate results are visible to course members

#### Scenario: Invalid maximum is rejected
- **WHEN** staff creates a three-option multi-select poll with a maximum of four
- **THEN** validation fails and no post or poll state is stored

#### Scenario: Deadline offset is required
- **WHEN** staff creates a poll with an offset-free close time
- **THEN** validation fails and no post or poll state is stored

#### Scenario: Multi-select requires controlled release
- **WHEN** staff creates a multi-select poll without a release mode or with live release
- **THEN** validation fails and no post or poll state is stored

### Requirement: Members submit private, editable ballots until the poll closes

An active course member SHALL be able to submit, replace, or retract their own ballot on an open poll. A single-select ballot SHALL contain one valid option; a multi-select ballot SHALL contain between one and the configured maximum distinct valid options. The existing single-option vote request SHALL remain valid for single-select polls. A ballot update SHALL replace the entire prior selection atomically, not append to it. Invalid, duplicate, cross-poll, or over-limit choices SHALL fail without changing the previous ballot. A closed poll or archived course SHALL reject all ballot changes and retractions with `409 poll_closed`; a hidden, deleted, or unrelated post SHALL retain the existing not-found behavior. Ballot changes SHALL not advance the post version or activity time.

#### Scenario: A student changes a multi-select ballot
- **WHEN** a student votes for options A and B, then submits B and C
- **THEN** the student's ballot is B and C, and aggregate counts reflect exactly one current ballot

#### Scenario: An invalid replacement preserves the ballot
- **WHEN** a student with a valid ballot submits too many choices or an option from another poll
- **THEN** the request fails and the original ballot and aggregates are unchanged

#### Scenario: A closed poll rejects retraction
- **WHEN** a member retracts a ballot after the poll closes
- **THEN** the API returns `409 poll_closed` and the ballot remains unchanged

### Requirement: Staff control closing and irreversible result release

Current course TAs and instructors SHALL be able to close and reopen an active poll manually, and release its results manually. An optional deadline SHALL close the poll when reached even if no background worker runs. Automatic-on-close release SHALL release results when either manual or deadline closing occurs. Once results are released, reopening SHALL NOT hide them. Reopening a poll whose deadline has passed SHALL clear that elapsed deadline to make the poll genuinely open. Staff lifecycle changes SHALL be authorization- and CSRF-protected, conditional on the poll version to avoid lost updates, and SHALL reject deleted posts and inactive courses.

#### Scenario: Deadline closes an idle poll
- **WHEN** the configured deadline passes without a worker running
- **THEN** the next read or vote observes the poll closed and voting is rejected

#### Scenario: Reopen retains released results
- **WHEN** staff reopen a closed poll whose results were released and whose deadline has passed
- **THEN** it accepts ballots again, the old deadline is cleared, and results stay released

#### Scenario: A stale staff transition is rejected
- **WHEN** staff submits a close or release change using an obsolete version
- **THEN** the change is rejected without overwriting a newer transition

### Requirement: Ballot identities are never exposed through poll results

Ballots SHALL remain linked to user accounts internally for edit and retraction, but poll list/detail, vote responses, and CSV SHALL never include voter identities or voter-to-option mappings for any role. Current staff SHALL see live aggregate option counts and the number of ballots, including before release. Students SHALL see their own current selected options but no aggregate counts, percentages, total, or explanation until results are released. After release, current course members SHALL see aggregates and the optional explanation. Result visibility SHALL apply consistently to list, detail, and mutation responses, including zero-vote polls. Responses containing private poll state SHALL not be shared across viewers.

#### Scenario: Student views unreleased results
- **WHEN** a student reads or votes on an unreleased poll
- **THEN** the response identifies only their own selections and omits aggregate counts, total, percentages, and explanation

#### Scenario: Staff views live results
- **WHEN** a TA reads an unreleased poll
- **THEN** aggregate counts and ballot total are visible but no ballot identity or voter roster is visible

#### Scenario: Results are released
- **WHEN** staff release results for a poll with an explanation
- **THEN** members can read aggregate counts and explanation without learning voter identities

### Requirement: Staff export aggregates and clone a clean poll

Current course TAs and instructors SHALL be able to download a CSV of the poll's aggregate results whether or not results are released to students. It SHALL contain option labels, counts, and aggregate totals and SHALL contain no account IDs, names, email addresses, ballot records, or voter-to-option mappings. Current staff SHALL also be able to clone an active poll into a new poll in the same course, copying its title, body, options, ballot mode, maximum, release mode, and explanation. The clone SHALL have a new identity and no ballots, deadline, closed state, or released state. A legacy live-results source SHALL clone into manual release so the clone can start unreleased; all other stable settings and options are copied. A member without staff privileges SHALL not be able to export or clone.

#### Scenario: Aggregate export is private
- **WHEN** a TA exports results from an unreleased multi-select poll
- **THEN** the CSV includes aggregate options and ballot total but no identifying ballot information

#### Scenario: Clone resets transient state
- **WHEN** staff clone a closed, released poll with ballots and an elapsed deadline
- **THEN** the new poll has copied settings and options but is open, unreleased, without a deadline or ballots

#### Scenario: Student cannot export or clone
- **WHEN** a student requests an aggregate CSV or clone
- **THEN** the request is denied and no clone is created

### Requirement: Course UI supports advanced poll workflows

The composer SHALL let staff choose ballot mode and maximum, optional close time, release mode, and explanation. The poll view SHALL use radio controls for single-select and checkboxes for multi-select, enforce the maximum accessibly, and show own selections even when results are hidden. Staff SHALL have close, reopen, release, export, and clone controls with accurate state and error feedback. Member views SHALL not disclose hidden results through labels, percentages, bars, accessible text, or client state derived from API responses.

#### Scenario: Member votes before release
- **WHEN** a student opens an unreleased multi-select poll and chooses too many options
- **THEN** the UI explains the maximum and prevents submission without exposing totals

#### Scenario: Staff release results in the browser
- **WHEN** staff release results for a closed poll
- **THEN** the updated view shows aggregate results and the explanation to members
