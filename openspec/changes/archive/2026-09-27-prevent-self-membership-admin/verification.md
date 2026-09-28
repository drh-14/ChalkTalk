# Verification

- Rendered Course settings test failed before the UI change because the signed-in instructor had a role selector; passed after the own-row guard was added. The test includes a paginated roster where the own row arrives later.
- PostgreSQL-backed HTTP test failed before the service change because a self-targeted no-op PATCH returned `200`; passed after both explicit-target mutations rejected self-targeting. It covers `403 permission_denied`, unchanged membership and ETag, `428`/`412` precedence, administration of another member, and `/members/me` departure with another instructor remaining.
- Existing tests retain unauthorized `404` concealment and final-instructor protection; the fake HTTP contract success fixture now targets another member.
- Focused API and frontend tests: 39 passed.
- Full database-backed `npm test`: 164 passed across 19 files.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run format:check`: passed.
- `openspec validate prevent-self-membership-admin --strict`: passed.
- Running Compose HTTPS health check at `https://localhost:5173/api/health`: `{"status":"ok"}`.
