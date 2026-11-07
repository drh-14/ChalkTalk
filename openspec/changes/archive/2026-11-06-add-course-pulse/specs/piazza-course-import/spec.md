## ADDED Requirements

### Requirement: Imported image names drop Piazza's NaN suffix

When importing a Piazza class, the importer SHALL remove a trailing `NaN` that Piazza appends to the alternative text of pasted images, so the imported Markdown image shows the original file name. Re-importing a class SHALL replace earlier converted content with the corrected name.

#### Scenario: A pasted screenshot is imported

- **WHEN** a Piazza post contains an image whose alternative text is `Screenshot.jpgNaN`
- **THEN** the imported body contains `![Screenshot.jpg](...)`
