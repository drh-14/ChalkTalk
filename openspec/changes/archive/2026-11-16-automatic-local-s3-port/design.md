## Decision

Use Compose long port syntax with target 8333 and host_ip 127.0.0.1, omitting published so Docker allocates an unused port atomically. Internal services retain http://seaweedfs:8333. Host clients discover the running mapping with docker compose port seaweedfs 8333 and set S3_ENDPOINT accordingly. The existing S3 smoke script already discovers that mapping. No custom allocator or additional service is needed.

## Validation

With host port 8333 occupied, Docker allocated 127.0.0.1:32770. Authenticated S3 upload/download, restart persistence, and teardown passed; restart changed the mapping to 32771, which the smoke test rediscovered. Port-discovery regression tests and 12 Compose tests passed. One existing env-file metadata test fails with the installed Compose version (env_file omitted by config output). Formatting, shell syntax, and whitespace checks passed.
