## ADDED Requirements

### Requirement: Question detail presents answer cards and followup discussions

The question detail SHALL show all answer cards in a distinct colored area, rendered Markdown and LaTeX, visible editor names subject to anonymity, and an upvote control beneath each answer's text. It SHALL show a followup heading with the root count and a collapsed full-width compose prompt when there are no discussions. Opening answer or followup composition SHALL use the same Markdown/LaTeX editor toolbar and preview as post creation. Followups SHALL show replies and upvotes. Permitted actions SHALL reflect server-projected capability and keep local draft text on a failed save or version conflict. Answers and followups SHALL not upload or render images/documents in this phase.

#### Scenario: Empty followups
- **WHEN** a member opens a question with no discussions
- **THEN** a zero count and prominent compose prompt are displayed

#### Scenario: Author edits an answer
- **WHEN** a member with edit capability opens an answer editor and saves valid Markdown
- **THEN** the updated formatted text and editor byline appear in that card

#### Scenario: Stale edit
- **WHEN** an answer save receives a version conflict
- **THEN** the editor remains open with the member's draft and a refresh action
