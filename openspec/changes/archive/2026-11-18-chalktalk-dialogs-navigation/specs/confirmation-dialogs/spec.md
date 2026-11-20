## Purpose

Keep consequential in-app actions and navigation understandable and accessible without relying on browser-native confirmation windows.

## ADDED Requirements

### Requirement: Styled accessible confirmation

In-app actions requiring confirmation SHALL display a ChalkTalk-styled dialog with an accessible label, explicit Confirm and Cancel actions, keyboard focus containment, Escape cancellation, and focus restoration after dismissal.

#### Scenario: Confirm action

- **WHEN** a user confirms an action in the dialog
- **THEN** the original action executes once and the dialog closes

#### Scenario: Cancel action

- **WHEN** a user cancels or presses Escape
- **THEN** the original action does not execute, the dialog closes, and focus returns to the trigger

#### Scenario: Repeated request

- **WHEN** another confirmation request arrives while a dialog is open
- **THEN** no second dialog stacks and the guarded action cannot execute twice

### Requirement: Guarded navigation awaits confirmation

The application SHALL preserve unsaved edits and the current route while awaiting confirmation to leave, then continue the intended navigation once only if confirmed.

#### Scenario: Cancel guarded route change

- **WHEN** a user cancels confirmation during internal or Back/Forward navigation
- **THEN** the current route, URL, and unsaved edits remain unchanged

#### Scenario: Confirm guarded route change

- **WHEN** a user confirms leaving with unsaved edits
- **THEN** the intended route is shown once and the edits are discarded

#### Scenario: Save in progress

- **WHEN** a save is in progress and navigation is disallowed
- **THEN** navigation stays blocked without opening a confirmation dialog
