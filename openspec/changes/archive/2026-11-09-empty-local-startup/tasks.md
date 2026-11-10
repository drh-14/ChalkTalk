## 1. Tests first

- [x] 1.1 Add a Compose configuration test requiring app, migrations, data, and monitoring in the default service list and no `seed-mock`; run it and observe failure on the old profile layout.
- [x] 1.2 Add an import-command test proving a demo-password environment value cannot grant common credentials; run it and observe failure on the old CLI.

## 2. Implementation

- [x] 2.1 Remove local Compose profiles and automatic seed dependency/service; verify `docker compose config --services` lists the complete stack and a fresh database has no course.
- [x] 2.2 Remove demo/mock entries from local env templates and public startup scripts, and remove the import CLI demo-password option; verify focused tests pass.
- [x] 2.3 Update the root and local READMEs for the single default command and explicit Piazza import; verify all documented commands and links.

## 3. Verification

- [x] 3.1 Run focused Compose/import tests, the API build, lint, and format checks; verify the change spec strictly.
