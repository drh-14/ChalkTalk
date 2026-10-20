## ADDED Requirements

### Requirement: Resource chooser separates adjacent filename text
The Resources native Choose File button SHALL have a 4.4px margin-inline-end before adjacent filename or No file chosen text, approximately 10% above the measured 4px baseline. Existing primary button styling, padding, native chooser accessibility and upload behavior SHALL remain unchanged.

#### Scenario: Empty selection and long filename
- **WHEN** an instructor views the Resources chooser before selection or after selecting a long supported filename at desktop or mobile width
- **THEN** the margin is 4.4px and the page has no horizontal overflow
