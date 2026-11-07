# ChalkTalk deployment setups

- [Local development](local/README.md): PostgreSQL with pgvector and SeaweedFS in Docker Compose, with Resend HTTPS email. The root `docker compose` command remains available.
- [Single-VM production](production/README.md): frontend, API, collaboration, and worker containers backed by Supabase PostgreSQL/Storage and Resend.

There is no custom production flag. The production images set `NODE_ENV=production`; the two setups have separate Compose and environment files. VM provisioning and automated deployment are not part of this skeleton.
