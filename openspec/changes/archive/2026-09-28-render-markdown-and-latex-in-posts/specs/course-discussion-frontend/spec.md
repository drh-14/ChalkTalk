## ADDED Requirements

### Requirement: The post composer provides selection-aware formatting controls

The post-body editor SHALL provide accessible controls for bold, italic, heading, link, bulleted list, numbered list, inline code, inline LaTeX, and block LaTeX above the body field. Bold, italic, inline code, and inline LaTeX SHALL surround selected text with `**`, `*`, backticks, and `$` respectively; with an empty selection they SHALL insert both delimiters and put the caret between them. Activating a control SHALL preserve the intended selection and return focus to the body editor, so subsequent typing occurs at the intended position. Controls SHALL insert syntax rather than toggle or parse existing formatting.

#### Scenario: An author formats selected text

- **WHEN** an author selects `ptr` in the body and activates Bold
- **THEN** the draft contains `**ptr**` at that position, with `ptr` between the bold delimiters and surrounding text unchanged

#### Scenario: An author inserts formatting at the caret

- **WHEN** an author activates Inline math with no selected text and then types `x^2`
- **THEN** the draft contains `$x^2$` at the insertion point, with the typed expression between the math delimiters

#### Scenario: An author inserts inline code or italic text

- **WHEN** an author selects body text and activates Inline code or Italic
- **THEN** only that selection is surrounded by the corresponding Markdown delimiters and remains between them

### Requirement: Line, link, and block controls produce valid source syntax

Heading SHALL prefix the current line, or each selected line, with `### `. Bulleted and numbered list controls SHALL prefix the current line or each selected line with valid Markdown list markers; numbered list markers SHALL increment from `1.` for a multiline selection. Link SHALL insert `[label](url)`, using selected text as `label` and placing the caret in `url`, or placing the caret inside an empty label when nothing is selected. Inline math SHALL use `$...$`; Block math SHALL place `$$` on separate lines around selected text or a blank interior line, with the caret inside the block when there is no selection. Line and block actions SHALL not overwrite neighboring text at document boundaries.

#### Scenario: An author formats multiple lines as a list

- **WHEN** an author selects three body lines and activates Numbered list
- **THEN** those lines begin with `1. `, `2. `, and `3. ` respectively, without altering unselected neighboring lines

#### Scenario: An author adds a link

- **WHEN** an author selects `notes` and activates Link
- **THEN** the draft contains `[notes](url)` and the caret is in the destination field

#### Scenario: An author adds display math

- **WHEN** an author selects an equation and activates Block math
- **THEN** the equation is between standalone `$$` delimiter lines and adjacent prose remains outside the math block

### Requirement: The composer previews the unsent formatted body

The composer SHALL offer Write and read-only Preview modes for the current body draft. Preview SHALL render the same supported Markdown and LaTeX as published post detail without changing the draft, other form fields, or the pending create request. Switching back to Write SHALL restore an editable body and preserve the intended caret or selection. Publishing SHALL submit the raw `bodyMarkdown` source through the existing creation flow; a failed request SHALL retain the formatted draft.

#### Scenario: An author checks a formula before publishing

- **WHEN** an author enters Markdown and `$x^2$`, switches to Preview, and returns to Write
- **THEN** Preview displays the formatted content and the source text and unsent form fields remain unchanged

#### Scenario: A formatted post fails to publish

- **WHEN** the create-post request fails after formatting was inserted
- **THEN** the composer retains the raw formatted body for a deliberate retry

### Requirement: Completed LaTeX errors are marked as the author types

After every body text edit, the editor SHALL parse the current Markdown and math source and validate each complete inline or block LaTeX expression. It SHALL place a red underline on the source range of any complete expression rejected by the LaTeX renderer, without changing the source or blocking publication. A diagnostic SHALL include concise text that keyboard and assistive-technology users can discover without relying on color or repeated alerts. Unclosed math delimiters SHALL remain neutral while typing; ordinary Markdown syntax that renders as literal text SHALL not be labeled erroneous. Escaped dollar signs and dollar signs inside code SHALL not be treated as math. When an expression is corrected or removed, its underline SHALL disappear in response to that edit, without waiting for a pause or explicit validation action. Older diagnostic results SHALL not replace results for newer text, and checking SHALL not prevent responsive editing of bodies within the existing length limit.

#### Scenario: An author completes an invalid inline expression

- **WHEN** an author types a closing `$` around LaTeX that the renderer rejects
- **THEN** the completed expression receives a red underline and a readable diagnostic after that edit

#### Scenario: An author corrects an expression

- **WHEN** the author changes a rejected expression into valid LaTeX or deletes it
- **THEN** the underline is removed in response to that edit without waiting for an idle timeout

#### Scenario: An author is still typing math

- **WHEN** an author has opened but not closed an inline or block math expression
- **THEN** the unfinished expression has no error underline

#### Scenario: Markdown and escaped syntax remain ordinary text

- **WHEN** a draft contains unmatched Markdown markers, escaped dollar signs, or dollars inside a code span
- **THEN** the editor does not invent LaTeX diagnostics for those ranges

### Requirement: Post bodies render Markdown and LaTeX consistently and safely

Preview, ordinary post detail, and staff duplicate review SHALL use the same supported Markdown and LaTeX behavior, including `$...$` inline math and standalone `$$` display math. User-authored raw HTML, unsafe links, and untrusted LaTeX commands SHALL not execute or load external resources. Malformed or unsupported LaTeX SHALL leave readable content without blanking the entire post. Feed cards and Related questions SHALL remain escaped plain-text excerpts rather than rendered Markdown or interactive math.

#### Scenario: A member reads a post containing formatted text and math

- **WHEN** a post body contains `**cutoff**`, `$x^2$`, and a standalone `$$` display expression
- **THEN** the full post displays bold text, inline math, and display math while retaining the same source text in storage

#### Scenario: Staff review a retained duplicate body

- **WHEN** a staff member opens a duplicate whose retained body contains Markdown and LaTeX
- **THEN** that body renders with the same formatting and safety behavior as ordinary post detail

#### Scenario: A post contains hostile or malformed formatting

- **WHEN** a post body contains raw HTML, an unsafe link, or malformed LaTeX
- **THEN** no author-supplied script or unsafe resource executes, the malformed expression remains readable, and the rest of the post remains visible
