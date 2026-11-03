## Context

`loadEnvironment` currently embeds localhost frontend URL fallbacks and nine `RATE_LIMIT_*`-backed positive integers. The rate-limit object is consumed across authentication and collaboration services. Deployments still need to configure frontend origins for CORS and email links.

## Goals / Non-Goals

- Preserve the present numeric limits and windows.
- Remove rate-limit override inputs, not the rate-limit object consumed by callers.
- Preserve deployment-specific frontend URL overrides and validation.
- No API, database, UI, or runtime service redesign.

## Decisions

- Introduce `apps/api/src/config/constants.ts` exporting one immutable rate-limit object and localhost frontend defaults.
- `loadEnvironment` uses those constants and does not read `RATE_LIMIT_*` keys. It keeps the existing URL parsing/validation and collaboration idle timeout parser.
- Remove obsolete rate-limit lines from `.env.example` and reword README/API docs to point to the constants module. Keep frontend env variables documented.

## Risks / Trade-offs

Changing a rate limit now requires a code deployment rather than an operator environment update. This is intentional. Legacy variables are ignored to avoid breaking old environment files; documentation stops presenting them as controls.

## Verification

Configuration tests assert exact values, ignored legacy overrides including invalid inputs, defaults, valid frontend overrides, and invalid origin/base combinations. Run focused tests, typecheck, lint, and formatting checks.
