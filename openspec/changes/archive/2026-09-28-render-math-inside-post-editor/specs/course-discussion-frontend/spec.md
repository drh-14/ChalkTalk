## ADDED Requirements

### Requirement: Valid math renders inside the editable post body without changing source

The post-body editor SHALL render complete valid `$...$` inline expressions and standalone multiline `$$` expressions inside the editable text box when the caret and selection do not touch their source ranges. The underlying editor document and submitted `bodyMarkdown` SHALL remain the exact raw Markdown. The same untrusted KaTeX policy used in Preview SHALL apply. Escaped dollars and math-looking text inside code SHALL not render as math.

#### Scenario: An author types valid math

- **WHEN** an author completes `$x^2$` or a standalone `$$` block and moves the caret outside its source range
- **THEN** the editor shows the formula as rendered math while preserving the exact source for submission, clipboard, and undo

#### Scenario: An author writes escaped or code text

- **WHEN** dollar signs are escaped or inside Markdown code
- **THEN** those characters remain source text and do not become rendered formula widgets

### Requirement: Editing a formula reveals its exact source

The editor SHALL show the raw delimiters and TeX whenever the caret touches either boundary or is inside a complete formula, whenever a selection intersects one, or when the author activates its rendered formula by pointer. It SHALL restore rendering after the caret leaves and the expression remains valid. Keyboard movement, replacement, toolbar insertion, copy/paste, undo/redo, and IME composition SHALL operate on the raw document; formula replacement ranges SHALL not be atomic. Clicking a widget SHALL reveal and focus its source for editing.

#### Scenario: An author edits rendered inline math

- **WHEN** the author moves the caret into or clicks a rendered `$x^2$` expression
- **THEN** the editor reveals `$x^2$` as editable source and does not alter the stored text

#### Scenario: A selection overlaps display math

- **WHEN** a selection intersects a rendered `$$` expression
- **THEN** its source is visible so the selection can be copied or replaced as raw Markdown

### Requirement: Invalid and unfinished math remains editable source

Invalid complete LaTeX SHALL remain source with its existing red underline and accessible diagnostic. Unfinished math SHALL remain source without an invented error. Results from prior document versions SHALL not render over newer edits. If analysis, worker delivery, or formula rendering fails, the author SHALL still be able to edit and submit raw text.

#### Scenario: A complete expression becomes invalid and is corrected

- **WHEN** an author changes valid math to rejected TeX and later fixes it
- **THEN** rendering gives way to visible underlined source while invalid, then returns after a valid result and the caret leaves

#### Scenario: The worker fails

- **WHEN** formula analysis is unavailable
- **THEN** raw text remains editable, and no stale formula covers it
