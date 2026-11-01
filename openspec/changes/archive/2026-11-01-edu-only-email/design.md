## Context

The auth service currently checks an environment allowlist at verification request time, while account creation consumes tokens without rechecking admission. The frontend signup form relies on the API. Organizations are keyed by exact email domain.

## Goals / Non-Goals

- Admit verified `.edu` domains, including valid subdomains, without a configured allowlist.
- Keep exact-domain school/course boundaries, existing error code and login/reset behavior.
- No migration, DNS ownership check, or generic TLD detection.

## Decisions

- Use one server-side admission check over the normalized address. Require a 1–64-character ASCII dot-atom local part, valid ASCII DNS labels, and a terminal `.edu` label, not `endsWith("edu")` on the whole address. Apply at verification, token consumption for account creation, and profile email change; retain the permissive normalizer for legacy login and reset.
- Keep client validation in the signup form for immediate feedback; server remains authoritative. HTML `type=email` provides syntax assistance but not the `.edu` policy.
- Remove the allowlist field and environment parser; ignore legacy deployment values only by removing them from templates and documentation.
- Retain `domainFor(proof.email)` for exact-domain organization identity and same-domain profile checks.

## Risks / Trade-offs

- `.edu` suffix does not prove educational affiliation by itself; email verification proves control of the mailbox. This policy is deliberately broader than the old allowlist.
- Existing non-`.edu` users remain able to log in/reset but cannot change to another non-`.edu` address.
