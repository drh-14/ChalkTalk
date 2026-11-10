## REMOVED Requirements

### Requirement: AMS161 mock data is explicit and local-only

**Reason**: Local startup shall be empty rather than contain a configurable mock-data path.
**Migration**: Use an explicit Piazza course import or create a course in the application.

### Requirement: Prototype contains realistic course discussion

**Reason**: The automatic local prototype course is removed from the developer startup path.
**Migration**: Import a chosen Piazza course explicitly.

### Requirement: Repeated startup preserves local edits

**Reason**: No fixture-seed step remains on startup.
**Migration**: Compose preserves its named volumes; explicit imports have their own lifecycle.

### Requirement: Fixture statistics reflect persisted activity

**Reason**: Fixture content is no longer provisioned by local startup.
**Migration**: Statistics for an explicitly imported course use the ordinary application flow.

### Requirement: Fixture math uses rendered LaTeX

**Reason**: Fixture content is no longer provisioned by local startup.
**Migration**: Imported or user-authored math uses the ordinary renderer.

### Requirement: Dedicated demo student login

**Reason**: Demo credentials are no longer part of local configuration.
**Migration**: Create or sign into a normal account.

### Requirement: Demo seed loads the committed Piazza courses

**Reason**: A fresh local installation shall not import committed exports automatically.
**Migration**: Run the Piazza import command against the course selected by the operator.
