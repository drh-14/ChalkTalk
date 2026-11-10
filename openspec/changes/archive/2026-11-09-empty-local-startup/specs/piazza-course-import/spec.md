## ADDED Requirements

### Requirement: Piazza import is an explicit course operation

The developer import command SHALL import only the Piazza class or export explicitly selected by its operator. It SHALL NOT read a demo-password environment variable. Historical imported accounts that do not already have normal ChalkTalk credentials SHALL receive unguessable, non-disclosed credentials rather than a shared login password.

#### Scenario: Operator imports a saved class export

- **WHEN** the operator invokes the import command with an existing owner account and a chosen export file
- **THEN** that course is imported without loading unrelated committed fixtures
- **AND** no demo password is required or accepted

#### Scenario: Import runs without a shared credential

- **WHEN** new historical author identities are created during import
- **THEN** they cannot sign in with a common demo credential
