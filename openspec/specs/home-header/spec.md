# home-header Specification

## Purpose

Keep authenticated home navigation, notifications and course-entry actions usable across desktop and mobile widths while preserving existing styling, accessible interactions and other page headers.

## Requirements

### Requirement: Home header uses available width

The authenticated home-page header SHALL place its existing ChalkTalk logo at the left and notifications/profile controls at the right across the available viewport width, retaining its existing horizontal outer padding of 1.25rem.

#### Scenario: Wide desktop home

- **WHEN** an authenticated user opens /home at a 1440px viewport and the default 16px root font size
- **THEN** the logo begins 20px from the left viewport edge and the account controls end 20px from the right edge
- **AND** the home main content retains its centered 64rem maximum width

#### Scenario: Narrow home

- **WHEN** an authenticated user opens /home at a 390px or 320px viewport
- **THEN** the existing logo and controls remain visible with the same outer padding and no horizontal page overflow

### Requirement: Existing header behavior is preserved

The change SHALL preserve existing home header styling, accessible controls and menus, and SHALL NOT change course-page or account-settings headers.

#### Scenario: Home account and notifications

- **WHEN** the user activates the notifications or labeled account button on desktop or mobile
- **THEN** the existing respective panel opens within the viewport and existing keyboard focus and dismissal behavior remains available

#### Scenario: Course header regression

- **WHEN** the user opens a course page at desktop or mobile width
- **THEN** its existing logo, course selector, tabs, account controls and responsive layout remain unchanged

#### Scenario: Account settings header regression

- **WHEN** the user opens /account at 1440px width
- **THEN** its original centered 64rem header and 20px inner padding remain unchanged

### Requirement: Home notifications stay within the mobile viewport

The home notification panel SHALL retain its existing bell-relative right and vertical anchors, styling, contents and accessible interactions. Its width SHALL fit the available horizontal space with at least the existing 1.25rem left gutter, without altering course-page panels.

#### Scenario: Mobile populated notification panel

- **WHEN** the user opens notifications on /home at 390px or 320px width with the default root font size
- **THEN** the populated panel begins 20px from the left viewport edge and its right edge aligns with the bell container
- **AND** its contents remain readable within the viewport without horizontal page overflow
- **AND** Escape closes the panel and returns focus to the bell

#### Scenario: Desktop panel anchoring

- **WHEN** the user opens home notifications at 1440px width
- **THEN** the existing 24rem panel width and bell-relative anchor remain unchanged

### Requirement: Home course actions share one row

The home Create course and Join a course controls SHALL remain side by side in that order at desktop and supported mobile viewport widths. They SHALL retain their full labels, accessible names, styles, existing 12px gap and at least their existing 40px target height. Labels MAY wrap inside their buttons to avoid overflow; text or target sizes SHALL NOT be reduced.

#### Scenario: Minimum-width home actions

- **WHEN** the user opens /home at 320px width
- **THEN** both buttons share the same row with Create course before Join a course and no horizontal overflow
- **AND** full labels remain visible within the buttons, wrapping as needed with unchanged typography and padding

#### Scenario: Larger home actions and form activation

- **WHEN** the user opens /home at 390px or 1440px width
- **THEN** both buttons retain their existing single-line same-row appearance
- **AND** activating either accessible control opens its existing corresponding form
