## Purpose

Give accepted internal navigation the same brief visual entrance as production post content without interrupting interaction or remounting feature state.

## ADDED Requirements

### Requirement: Accepted navigation enters with production motion

The application SHALL apply a whole-page opacity entrance from transparent to opaque over 160 milliseconds with ease timing on initial ready load and each accepted internal navigation, including browser Back and Forward.

#### Scenario: Navigate to route

- **WHEN** an internal navigation is accepted
- **THEN** the destination page begins the entrance immediately without delaying interaction

#### Scenario: Initial ready load

- **WHEN** session restoration completes and the first route view becomes ready
- **THEN** the initial page uses the same entrance

#### Scenario: Rapid navigation

- **WHEN** another internal navigation occurs before the prior entrance ends
- **THEN** the prior entrance is cancelled and only the newest entrance remains active

### Requirement: Avoid unnecessary or unwanted motion

The application SHALL NOT run the entrance for cancelled navigation, external/new-tab links, same-page search or filter URL replacements, or when reduced motion is preferred.

#### Scenario: Search update

- **WHEN** a same-page search or filter updates the URL
- **THEN** the page does not fade again

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion
- **THEN** navigation displays the page without an entrance animation
