# piazza-course-import Specification

## Purpose

How a Piazza class export is converted into ChalkTalk content by the developer import tool.

## Requirements

### Requirement: Imported Piazza tables become Markdown tables

When importing a Piazza class, the importer SHALL convert each HTML table in a post, answer, or followup into a GFM pipe table. The first row SHALL become the header row, whether its cells are header or data cells. Rows with fewer cells SHALL be padded with empty cells to the widest row. Each cell SHALL keep its inline formatting and links on one line: line breaks and block content inside a cell SHALL become spaces, and a `|` in cell text SHALL be escaped. A table nested inside a cell SHALL be flattened to its text. Re-importing a class SHALL replace earlier converted content with the table form.

#### Scenario: A grade distribution table is imported

- **WHEN** a Piazza note body contains a table whose first row is an empty cell followed by `Excellent`, `Good`, and whose next row is `Instructor`, `7`, `6`
- **THEN** the imported body contains a pipe table with header `|  | Excellent | Good |`, a delimiter row, and the row `| Instructor | 7 | 6 |`

#### Scenario: A cell contains a pipe and a line break

- **WHEN** a table cell contains `a|b` and a `<br>` between two words
- **THEN** the cell becomes `a\|b` and the two words are separated by a space on one line

### Requirement: Imported image names drop Piazza's NaN suffix

When importing a Piazza class, the importer SHALL remove a trailing `NaN` that Piazza appends to the alternative text of pasted images, so the imported Markdown image shows the original file name. Re-importing a class SHALL replace earlier converted content with the corrected name.

#### Scenario: A pasted screenshot is imported

- **WHEN** a Piazza post contains an image whose alternative text is `Screenshot.jpgNaN`
- **THEN** the imported body contains `![Screenshot.jpg](...)`
