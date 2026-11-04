# Design

## Decisions

- **Reuse the importer.** The seed converts the committed export with `convertExport` and writes it with `importPiazzaCourse`, so seeded content matches a manual `db:import:piazza --from` run.
- **Seed only when absent.** The importer refreshes edited content on re-runs, which would undo local edits on every startup. The seed checks the deterministic course id first and skips when the course exists. A developer who wants fixture updates runs `db:import:piazza --from database/fixtures/cse416-piazza-export.json` explicitly.
- **Fixture location.** `database/fixtures/` sits beside migrations, which every API image and the Compose mount already include. The name avoids the ignored `piazza-*.json` pattern.

## Risks

- The fixture contains real classmates' names and posts in a public repository. The project owner accepted this.
