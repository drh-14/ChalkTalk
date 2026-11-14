## Context

The server validates `.edu` in `requireAcademicEmail`, used when issuing and consuming verification proofs and changing a profile email. Signup repeats the suffix check. Organizations are created or found by exact normalized email domain.

## Goals / Non-Goals

- Admit valid normalized ASCII addresses of any DNS domain at signup, retaining the current 254-character limit and 1–64-character dot-atom local-part rule.
- Keep email verification, token replay protection, atomic signup, and same-domain email changes.
- Keep exact-domain grouping, including for public providers, as explicitly chosen. Do not redesign organizations, invitations, or course visibility.

## Decisions

- Rename the server admission helper to reflect syntax rather than academic status and remove only the suffix restriction. Continue checking a token's embedded email at consumption so malformed legacy proofs remain rejected.
- Use `domainFor(proof.email)` unchanged as the organization key. No database migration is required.
- Remove the browser suffix check while retaining its syntax validation and accessible errors. Use neutral signup copy rather than school-only language.
- A verified profile replacement must still match the user's existing exact domain; a valid different-domain address receives the existing `email_domain_not_allowed` response.

## Risks / Trade-offs

- Shared public domains group unrelated users in the same organization and expose organization-level course listings to each other. This is the requested grouping policy, not an accidental side effect; document it clearly.
- Syntax validation is not deliverability validation. The existing email-verification token still proves mailbox control.
