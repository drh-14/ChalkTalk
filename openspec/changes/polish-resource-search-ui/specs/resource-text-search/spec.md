## ADDED Requirements

### Requirement: Resource search follows the shared interface design

The Resources page SHALL place its labeled search field directly after the page introduction and before instructor creation tools. The field SHALL use the established search-control typography, comfortable control height, rounded border, visible focus treatment, and an explicitly labeled clear button while a query is present. Clearing SHALL restore the catalog, retain open unsaved section/resource edits, and return focus to the search field.

During active search, creation forms SHALL be hidden from view and keyboard navigation so results directly follow search. Clearing SHALL restore those forms with their unsaved values.

Resource management inputs, selects, and action buttons SHALL use the application's existing theme and retain their labels, validation, disabled states, confirmation steps, and permissions. Pending extraction and unavailable extracted contents SHALL have distinct textual and visual treatments visible only to staff. Failure/unsupported notices SHALL NOT imply that the uploaded file cannot be downloaded.

Loading, empty, and recoverable search-error states SHALL have consistent spacing and theme colors. Errors SHALL retain the query and offer retry. Results and instructor controls SHALL remain usable at desktop and 390px mobile widths without horizontal page overflow. Existing plain-text highlights and search/pagination behavior SHALL remain intact.

#### Scenario: Instructor discovers search before creation tools

- **WHEN** an instructor opens Resources on desktop or mobile
- **THEN** the search field appears after the introduction and before the creation forms, without scrolling through those forms

#### Scenario: Member clears a themed search using the keyboard

- **WHEN** a member enters a query and activates Clear resource search
- **THEN** the catalog returns, the input is empty and focused, and any open unsaved editors retain their values

#### Scenario: Staff distinguishes extraction outcomes

- **WHEN** staff views pending, failed, unsupported and ready uploaded files
- **THEN** pending and unavailable states have distinct themed treatments and readable text, ready files need no notice, and students see none of these notices

#### Scenario: Search service temporarily fails

- **WHEN** a search request fails and the member retries
- **THEN** the themed error notice retains the query and provides retry, and a later success displays results normally

#### Scenario: Narrow screen resource controls

- **WHEN** an instructor views search results or edits Resources at 390px width
- **THEN** text and controls wrap within the viewport while labels, focus indicators and actions remain usable
