## 1. Contract and red tests

- [x] 1.1 Strictly validate the OpenSpec change before application code.
- [x] 1.2 Add failing App/route interaction tests for client-side Discussion→Settings→Discussion navigation, stable header identity, direct settings URL, Back/Forward, active navigation state, and no second session restoration.
- [x] 1.3 Add failing rendered tests for settings-content-only loading/error/retry, accessible announcements, existing course controls, and draft-discard confirmation on a refused navigation.

## 2. Shared course frame

- [x] 2.1 Introduce a course-scoped shell that keeps course name, Back to courses, and Discussion/Settings navigation mounted across the two views without duplicating data ownership.
- [x] 2.2 Change both course views to render route-specific content beneath the shared shell. Intercept course navigation for same-document routing while preserving URLs, Back/Forward, direct links, and current draft-discard behavior.
- [x] 2.3 Move settings loading/error/retry into the content region and style its narrower content column under the shared header. Respect reduced-motion preferences; do not add gratuitous animation.

## 3. Verification

- [x] 3.1 Run focused and full frontend tests, lint, typecheck, format, build, strict OpenSpec validation, and a relevant Compose HTTPS smoke check.
- [x] 3.2 Record verification and archive the OpenSpec change after implementation is complete.
