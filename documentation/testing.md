# Browser end-to-end coverage

The `test:browser:core` suite runs against ChalkTalk's real HTTPS gateway, API, PostgreSQL, and object storage in the disposable local Compose CI job. It exercises one representative browser journey per major area; mocked browser, unit, and API tests cover edge cases. A passing case count is not a count of distinct product flows.

| Area                              | Real-stack browser journey                                        |
| --------------------------------- | ----------------------------------------------------------------- |
| Account access                    | Log in and sign out through the UI                                |
| Course management                 | Create a course and join it with the course ID and code           |
| Question                          | Publish, answer, follow up, and reload persisted discussion       |
| Note                              | Publish an announcement and view it as a student                  |
| Poll                              | Publish, vote, and reload the persisted result                    |
| Resources                         | Upload a file and download identical bytes as a student           |
| Threads                           | Create a board and exchange messages between students             |
| Notifications                     | Mention a TA and open the resulting bell notification             |
| Course information and statistics | Update information, view it as a student, and export activity CSV |
| Collaboration                     | Separate two-browser live-session coverage in draft PR #246       |

Signup verification, password reset, email delivery, and detailed permissions/failure permutations remain in their existing API, mocked-browser, or manual live-stack tests; this smoke suite does not claim to cover every variation. The Piazza JSON import journey belongs in its feature change when that UI exists.

## Database isolation

Live browser fixtures seed unique accounts and, unless the journey creates one through the UI, a course. Set `E2E_DATABASE_URL`, `E2E_DB_GUARD_TOKEN`, and `E2E_DB_SYSTEM_IDENTIFIER` explicitly for every live-stack suite; `DATABASE_URL` is not a fallback. Set `E2E_BASE_URL` to the matching HTTPS gateway (the fixture defaults to `https://localhost:5173`). Before any seed write, the fixture verifies that the configured host connection has the supplied PostgreSQL system identifier, then checks that `chalktalk_e2e_guard` has exactly one row with the supplied 48-character hex token. CI obtains the identifier directly from its disposable Compose `postgres` container and creates the guard table and fresh token only after confirming that the database has no users or courses. Never point these tests at a production database or an SSH tunnel.

CI runs the suite serially with `npm run test:browser:core` and uploads the `core-browser-screenshots` artifact on success or failure. For a manual run, start a separate disposable bundled-database project with the [local launcher](../deployment/local/README.md), generate a new token with `openssl rand -hex 24`, and create its guard row there. Identify that project's PostgreSQL container by its `com.docker.compose.project` and `com.docker.compose.service=postgres` labels, then read its system identifier with `docker exec -i "$postgres_container" psql -U chalktalk -d chalktalk -tA -c "SELECT system_identifier::text FROM pg_control_system()"`. Set all four browser variables to that same stack; do not reuse a shared database or token.
