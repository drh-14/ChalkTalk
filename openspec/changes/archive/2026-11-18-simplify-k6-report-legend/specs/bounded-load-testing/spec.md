## ADDED Requirements

### Requirement: Concise load-report labels

The downloadable load-test HTML report SHALL show a color marker and series name, but no last-value column or numeric value, in each chart legend. It SHALL omit the verbose footer beginning “Source:”, while retaining the short production-wide API metrics label for database panels and point-hover values.

#### Scenario: View a chart legend
- **WHEN** a complete load-test report is generated
- **THEN** each chart legend displays series names with color markers and no displayed last values

#### Scenario: View the report footer and database panels
- **WHEN** a complete load-test report is generated
- **THEN** no “Source:” footer appears, the database charts retain their production-wide label, and hovering a plotted point still reveals its timestamp and value
