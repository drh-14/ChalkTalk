# external-link-navigation Specification

## Purpose

Define how ChalkTalk opens destinations outside normal in-app navigation while preserving the user's current app view.

## Requirements

### Requirement: External destinations open separately

The application SHALL open website links and file links in a new browser tab without granting the destination access to the originating window.

#### Scenario: Website link

- **WHEN** a user follows an external website link from rendered content or course resources
- **THEN** the destination opens in a separate tab and the ChalkTalk tab remains available

#### Scenario: File link

- **WHEN** a user follows an attachment or course file link
- **THEN** the file opens or downloads from a separate tab and the ChalkTalk tab remains available

### Requirement: In-app navigation remains in place

The application SHALL keep ordinary internal navigation in the current browser tab.

#### Scenario: Internal route

- **WHEN** a user follows an internal route such as a course or account link
- **THEN** the route opens in the current tab
