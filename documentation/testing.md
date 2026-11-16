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

Live browser fixtures seed unique accounts and courses. Set `E2E_DATABASE_URL`, `E2E_BASE_URL`, `E2E_DB_GUARD_TOKEN`, and `E2E_DB_SYSTEM_IDENTIFIER` explicitly for every live-stack suite; `DATABASE_URL` is not a fallback. Before any seed write, the fixture verifies that the configured host connection reaches the exact PostgreSQL instance identified directly from the disposable Compose `postgres` container, then checks that `chalktalk_e2e_guard` has exactly one row with this run's fresh 48-character hex token. CI creates the guard table and token only after confirming that its disposable Compose database has no users or courses. Never point these tests at a production database or an SSH tunnel.

CI runs the suite serially with `npm run test:browser:core` and uploads the `core-browser-screenshots` artifact on success or failure. For a manual run, use a separate disposable Compose database, generate a new token with `openssl rand -hex 24`, create its guard row there, read its identifier with `docker compose -f deployment/local/compose.yml --env-file .env exec -T postgres psql -U chalktalk -d chalktalk -tA -c "SELECT system_identifier::text FROM pg_control_system()"`, and set all four variables to that same stack; do not reuse a shared database or token.
