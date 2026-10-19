## ADDED Requirements

### Requirement: Consistent Resources action button shape and spacing
Course Resources Upload file, Add link, Try again and Load more buttons SHALL use radius-lg (0.85rem), vertical space-3 (0.75rem) and horizontal space-5 (1.25rem) at desktop and mobile sizes. Existing primary/secondary colors, minimum height, focus behavior and action semantics SHALL remain unchanged. Filename downloads and named external links SHALL remain links without separate Download buttons. Native file chooser styling SHALL remain unchanged.

#### Scenario: Desktop and mobile action controls
- **WHEN** an instructor views Resources and retries a failed list request or loads another page at desktop or mobile width
- **THEN** all visible action buttons have the specified corners and padding with their existing colors and no horizontal page overflow
