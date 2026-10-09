## 1. Search behavior

- [x] 1.1 Add PostgreSQL-backed HTTP tests for title and body typos, exact-first ranking, operator preservation, short queries, filters, visibility, pinned ordering, and complete cursor pagination. Run behavior-changing slices red before implementation.
- [x] 1.2 Add a migration enabling `pg_trgm` and indexing active post titles and bodies.
- [x] 1.3 Implement ordinary-query full-text and fuzzy union in `PostService.list`, with exact-first relevance, title preference, and complete keyset pagination. Preserve the existing full-text path for operator queries and staff duplicate review.

## 2. Documentation and verification

- [x] 2.1 Update the API reference, OpenAPI description, and database reference to describe the deployed search contract and index requirements.
- [x] 2.2 Run focused PostgreSQL-backed HTTP tests, relevant repository checks, and strict OpenSpec validation. Check the endpoint through HTTP for a matching typo and a short or operator query.
