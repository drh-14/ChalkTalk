## MODIFIED Requirements

### Requirement: Consistent Resources action button shape and spacing
Course Resources Upload file, Add link, Try again and Load more buttons SHALL use radius-lg (0.85rem), vertical space-3 (0.75rem) and horizontal space-5 (1.25rem) at desktop and mobile sizes. Existing primary/secondary colors, minimum height, focus behavior and action semantics SHALL remain unchanged. Filename downloads and named external links SHALL remain links without separate Download buttons. The native Browse/Choose File button SHALL match Add link primary background, foreground, border, font, radius, padding, minimum height and hover/focus/disabled feedback. The accessible labeled real file input, click and keyboard picker behavior, accept filter and disabled state SHALL remain unchanged.

#### Scenario: Desktop and mobile action controls
- **WHEN** an instructor views Resources and retries a failed list request or loads another page at desktop or mobile width
- **THEN** all visible action buttons have the specified corners and padding with their existing colors and no horizontal page overflow

#### Scenario: Native file picker at desktop and mobile sizes
- **WHEN** an instructor clicks or uses the keyboard to activate the labeled course-file input
- **THEN** the native chooser opens, selecting a supported file enables upload, the native button matches Add link visual treatment in normal, hover, keyboard-focus and disabled states, and the page has no horizontal overflow
