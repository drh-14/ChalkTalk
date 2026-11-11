# Disposable Supabase CI check

The `supabase-integration` job starts a local Supabase PostgreSQL and private
Storage stack, then runs only ChalkTalk's migration and API containers. It uses
synthetic accounts and a local Resend-shaped HTTP receiver; it does not read
production GitHub environment secrets or send mail externally.

The test exercises HTTP signup/login, course creation, resource upload and
download, nonmember denial, CSRF denial, invalid file rejection, and a stopped
Storage service. It also verifies the migration ledger and a private S3 object
round-trip. The job's unconditional cleanup removes the Compose containers and
Supabase volumes, including after failure.

Hosted Supabase, Resend, and public VM HTTPS smoke checks remain part of the
post-merge deployment workflow.
