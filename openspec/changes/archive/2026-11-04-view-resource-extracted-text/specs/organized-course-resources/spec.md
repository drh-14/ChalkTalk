## ADDED Requirements

### Requirement: Compact resource ordering

In manual order, instructors SHALL see compact arrow buttons at the right of resource cards, with accessible Move resource up and Move resource down names and at least 40px targets. Existing ordering requests, first/last boundaries, pending/pagination disabling and permission rules SHALL remain intact. Non-manual sorting and non-instructors SHALL NOT show resource ordering controls. Controls and card contents SHALL fit desktop and mobile viewports.

#### Scenario: Reorder a resource

- **WHEN** an instructor activates an enabled arrow
- **THEN** the existing order mutation moves the resource in that direction while the controls remain a compact right-hand group

#### Scenario: Boundaries and reader permissions

- **WHEN** a resource is first or last, more pages are unloaded, an action is pending, sorting is non-manual or the reader is not an instructor
- **THEN** the existing disable/hide rules prevent invalid ordering actions
