# Design

The `seed-mock` one-shot Compose service shares the API image and dependency volume. It waits for `migrate`; `api` waits for its successful completion. The seed command exits before connecting to PostgreSQL when `MOCK_DATA=false`. When enabled, it validates `AMS161_DEMO_INSTRUCTOR_PASSWORD` against the existing 12–128-character password rule, then writes the complete fixture in one transaction.

A fixed reserved UUIDv7 organization ID and `.invalid` domain mark successful seeding; the course ID is also a fixed UUIDv7. An advisory transaction lock serializes concurrent starts. Matching marker means no-op, preserving edited posts, unmerges, deleted courses, and the original password. Conflicting marker, course ID, join code, or active email fails without partial fixture writes. Student credentials are independently random and discarded. No password is logged.

The fixture uses the existing organizations, users, courses, course_memberships, and posts tables. Canonical questions precede duplicate inserts so the composite same-course foreign key is satisfied. Existing application reads already hide confirmed duplicates from students and expose them in the staff duplicate-review list.
