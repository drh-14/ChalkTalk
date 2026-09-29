## MODIFIED Requirements

### Requirement: Post bodies render Markdown and LaTeX consistently and safely

Composer Preview, ordinary post detail, staff duplicate review, feed cards, and Related questions SHALL use the same supported Markdown and LaTeX behavior, including `$...$` inline math and standalone `$$` display math. User-authored raw HTML, unsafe links, and untrusted LaTeX commands SHALL not execute or load external resources. Malformed or unsupported LaTeX SHALL leave readable content without blanking the entire post. Cards within the feed SHALL have equal compact fixed heights, and cards within Related questions SHALL have equal compact fixed heights, with long previews contained inside each card. Author-supplied links inside those previews SHALL display their labels without creating nested navigation targets, and images SHALL display their alt text without loading the image; activating the card SHALL navigate to the post.

#### Scenario: A member scans formatted post previews

- **WHEN** a feed card or Related questions item contains `**cutoff**`, `$x^2$`, a Markdown link, and an image
- **THEN** the preview displays bold text and rendered math, the link label appears as inert text inside a single card navigation link, and the image alt text appears without fetching the image

#### Scenario: Preview cards contain varied post lengths

- **WHEN** a feed or Related questions list includes short and long post bodies
- **THEN** cards in that list have equal compact heights, long content stays inside its card, and the full body is available in post detail

#### Scenario: A member reads a post containing formatted text and math

- **WHEN** a post body contains `**cutoff**`, `$x^2$`, and a standalone `$$` display expression
- **THEN** the full post displays bold text, inline math, and display math while retaining the same source text in storage

#### Scenario: Staff review a retained duplicate body

- **WHEN** a staff member opens a duplicate whose retained body contains Markdown and LaTeX
- **THEN** that body renders with the same formatting and safety behavior as ordinary post detail

#### Scenario: A post contains hostile or malformed formatting

- **WHEN** a post body contains raw HTML, an unsafe link, or malformed LaTeX
- **THEN** no author-supplied script or unsafe resource executes, the malformed expression remains readable, and the rest of the post remains visible
