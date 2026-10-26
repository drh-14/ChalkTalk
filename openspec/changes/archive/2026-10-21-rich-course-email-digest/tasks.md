## Specifications and decisions

- [x] Resolve entry cap and validate coherent OpenSpec artifacts.

## Renderer vertical slices

- [x] RED/GREEN public renderer tests for linked titles, own bodies, Unicode previews and plain text.
- [x] RED/GREEN parser sanitization and bounded malformed input tests.
- [x] RED/GREEN rendered equation CID PNGs and worker/resource bounds.
- [x] RED/GREEN bounded private image copies and safe fallbacks.

## Delivery integration

- [x] Extend typed SMTP payload without altering existing email behavior.
- [x] Project eligible body/entity and inject narrow S3 image reader in worker.
- [x] Verify real PostgreSQL/S3/Mailpit MIME, privacy and unchanged lifecycle behavior.

## Verification and delivery

- [x] Capture desktop/mobile rendered email screenshots.
- [x] Run focused/full tests, build, typecheck, lint and formatting.
- [x] Archive the verified OpenSpec change.
- [ ] Run no-mistakes and publish one-commit draft PR with final CI.
