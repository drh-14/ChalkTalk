## ADDED Requirements

### Requirement: Markdown bodies render GitHub-flavored Markdown

The browser SHALL render post, answer, followup, and composer-preview Markdown as GitHub-flavored Markdown, consistent with the digest email: pipe tables (with column alignment), strikethrough, task-list items as read-only checkboxes, and bare `http(s)` URLs and `www.` addresses as links. Rendering SHALL remain sanitized: raw HTML SHALL not execute, and links SHALL follow the existing safe-protocol and mention rules. A table wider than the post body SHALL scroll horizontally within the body rather than widening the page.

#### Scenario: A post contains a pipe table

- **WHEN** a member views a post whose body contains a GFM pipe table with a header row and data rows
- **THEN** the browser displays a table with header cells and data cells in their rows and columns

#### Scenario: A post contains a bare URL and strikethrough

- **WHEN** a body contains `https://example.edu/notes` and `~~old~~`
- **THEN** the URL is a link to that address and `old` is shown struck through

#### Scenario: A table is wider than the screen

- **WHEN** a member views a wide table on a narrow screen
- **THEN** the table scrolls horizontally inside the post body and the page does not scroll horizontally
