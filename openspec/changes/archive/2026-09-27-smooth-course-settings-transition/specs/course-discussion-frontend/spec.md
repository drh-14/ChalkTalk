## ADDED Requirements

### Requirement: Course discussion and settings share a stable frame

The protected Discussion and Course settings routes for the same course SHALL render the same course name, Back to courses control, and Discussion/Settings navigation in a persistent course header. Switching between them SHALL use same-document navigation, not reload the application or re-run session restoration. The active navigation item SHALL be identifiable visually and to assistive technology. Settings content MAY remain narrower than the discussion content.

#### Scenario: A member opens Course settings from Discussion

- **WHEN** a signed-in member activates Course settings
- **THEN** the course header remains visible, the URL changes to `/courses/{courseId}/settings` without a document reload, and the settings content replaces the discussion content

#### Scenario: A member returns to Discussion

- **WHEN** a member activates Discussion from Course settings or uses browser Back
- **THEN** the shared header remains, the discussion content returns, and the appropriate navigation item is active

### Requirement: Settings load and fail inside the shared course frame

On the settings route, course-specific membership and administration data SHALL load within the settings content area while the shared course header remains visible. Loading and error states SHALL be announced accessibly and SHALL provide retry when appropriate. Existing role-based controls and membership behavior SHALL remain available after loading. The transition SHALL remain understandable with reduced-motion preferences and SHALL not require animation.

#### Scenario: Settings data is still loading

- **WHEN** a member navigates to Settings and its data request has not completed
- **THEN** the course header remains visible and only the settings content area shows an accessible loading state

#### Scenario: Settings data fails to load

- **WHEN** the settings data request fails for a recoverable reason
- **THEN** the shared header remains visible and the settings content presents an error and retry control
